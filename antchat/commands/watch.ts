// antchat watch — long-lived background process that surfaces @-mentions
// across every joined room as macOS notifications.
//
// `antchat watch run`         — actually runs the watcher (this is what
//                               launchd invokes; never returns)
// `antchat watch install`     — write the LaunchAgent plist + bootstrap it
// `antchat watch uninstall`   — bootout the agent + remove the plist
// `antchat watch status`      — print plist path + whether file exists

import { realpathSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { config, type RoomTokenInfo } from '../../cli/lib/config.js';
import { subscribeRoomStream } from '../../cli/lib/sse.js';
import { notify, mentionsHandle, notifierAvailable } from '../lib/notifier.js';
import {
  buildPlist,
  writePlist,
  removePlist,
  loadAgent,
  unloadAgent,
  plistPath,
  defaultLabel,
} from '../lib/launchd.js';

function help(): never {
  console.error([
    'Usage:',
    '  antchat watch run                 # foreground watcher (launchd target)',
    '  antchat watch install             # register + start LaunchAgent',
    '  antchat watch uninstall           # stop + remove LaunchAgent',
    '  antchat watch status              # show LaunchAgent state',
  ].join('\n'));
  process.exit(1);
}

function binaryPath(): string {
  const exec = process.execPath;
  const looksInterpretive = /\/(?:bun|node)\b/.test(exec) && !/antchat$/.test(exec);
  const guess = looksInterpretive ? (process.argv[1] || exec) : exec;
  try { return realpathSync(guess); }
  catch { return guess; }
}

interface RoomBinding { roomId: string; token: RoomTokenInfo; }

function bindings(): RoomBinding[] {
  const all = config.listRoomTokens();
  const list: RoomBinding[] = [];
  for (const [roomId, tokens] of Object.entries(all)) {
    for (const tok of tokens) list.push({ roomId, token: tok });
  }
  return list;
}

async function runWatcher(): Promise<void> {
  if (!notifierAvailable()) {
    console.error('antchat watch: notifications only supported on macOS — exiting.');
    process.exit(1);
  }
  const rooms = bindings();
  if (rooms.length === 0) {
    console.error('antchat watch: no joined rooms. Run: antchat join ...');
    process.exit(1);
  }

  console.error(`[antchat-watch] subscribed to ${rooms.length} room(s):`);
  const aborts: AbortController[] = [];
  for (const { roomId, token } of rooms) {
    const serverUrl = (token.server_url || config.get('serverUrl') || '').trim();
    if (!serverUrl) {
      console.error(`[antchat-watch]   ${roomId} (${token.handle ?? '(no handle)'}) — SKIPPED, no server URL`);
      continue;
    }
    const handle = token.handle;
    console.error(`[antchat-watch]   ${roomId} (${handle ?? '(no handle)'}) at ${serverUrl}`);
    const abort = subscribeRoomStream({
      serverUrl,
      roomId,
      token: token.token,
      onEvent: ({ data, event }) => {
        if (event === 'closed') {
          console.error(`[antchat-watch] ${roomId} closed by host (token revoked)`);
          return;
        }
        const msg = data as {
          type?: string;
          sessionId?: string;
          sender_id?: string;
          target?: string | null;
          content?: string;
        };
        if (msg?.type !== 'message_created' || msg.sessionId !== roomId) return;
        if (msg.sender_id === handle) return;
        const targeted = handle && msg.target === handle;
        const mentioned = handle && msg.content && mentionsHandle(msg.content, handle);
        if (!targeted && !mentioned) return;

        const sender = msg.sender_id || 'someone';
        const summary = (msg.content ?? '').replace(/\s+/g, ' ').trim();
        notify({
          title: `antchat — ${sender}`,
          subtitle: `${roomId}${handle ? ` (${handle})` : ''}`,
          message: summary.length > 200 ? `${summary.slice(0, 197)}...` : summary,
          sound: 'Glass',
        });
      },
      onError: (err: any) => console.error(`[antchat-watch] ${roomId} stream error: ${err?.message ?? err}`),
    });
    aborts.push(abort);
  }

  const shutdown = () => {
    for (const a of aborts) a.abort();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Idle indefinitely. The SSE subscriptions keep the event loop alive on
  // their own (active fetch streams), but a setInterval here is a belt-
  // and-braces guard against runtimes that GC fetch readers when the
  // last user-space ref drops.
  setInterval(() => {}, 60_000).unref();
}

export async function watch(args: string[], flags: any, ctx: any) {
  const sub = args[0];
  if (!sub) help();

  if (sub === 'run') {
    await runWatcher();
    return;
  }

  if (process.platform !== 'darwin' && (sub === 'install' || sub === 'uninstall')) {
    console.error('antchat watch: install/uninstall is macOS-only.');
    process.exit(1);
  }

  if (sub === 'install') {
    const label = typeof flags.label === 'string' ? flags.label : defaultLabel();
    const args = ['watch', 'run'];
    const env: Record<string, string> = {};
    // Inherit ANT_SERVER if set so the watcher uses the same server as the
    // shell that ran install. Tokens carry their own server_url too, but
    // the env variable is the override path callers expect.
    if (process.env.ANT_SERVER) env.ANT_SERVER = process.env.ANT_SERVER;

    const path = writePlist({
      label,
      binaryPath: binaryPath(),
      args,
      env,
      stdoutPath: join(homedir(), 'Library', 'Logs', `${label}.out.log`),
      stderrPath: join(homedir(), 'Library', 'Logs', `${label}.err.log`),
    });
    const attempts = await loadAgent(label);
    const ok = attempts.some((a) => a.ok);
    if (ctx.json) {
      console.log(JSON.stringify({ ok, label, path, attempts }, null, 2));
      return;
    }
    console.log(`Wrote ${path}`);
    for (const a of attempts) {
      const tag = a.ok ? 'ok' : 'fail';
      console.log(`  ${a.cmd} -> ${tag}${a.stderr ? `: ${a.stderr.trim()}` : ''}`);
      if (a.ok) break;
    }
    if (!ok) {
      console.error('antchat watch: launchctl failed — see stderr above. Plist remains; rerun install once fixed.');
      process.exit(2);
    }
    console.log(`LaunchAgent ${label} bootstrapped.`);
    return;
  }

  if (sub === 'uninstall') {
    const label = typeof flags.label === 'string' ? flags.label : defaultLabel();
    const attempts = await unloadAgent(label);
    const removed = removePlist(label);
    if (ctx.json) {
      console.log(JSON.stringify({ ok: true, label, removed, attempts }, null, 2));
      return;
    }
    for (const a of attempts) {
      const tag = a.ok ? 'ok' : 'fail';
      console.log(`  ${a.cmd} -> ${tag}${a.stderr ? `: ${a.stderr.trim()}` : ''}`);
      if (a.ok) break;
    }
    console.log(removed ? `Removed plist ${plistPath(label)}` : `No plist at ${plistPath(label)}`);
    return;
  }

  if (sub === 'status') {
    const label = typeof flags.label === 'string' ? flags.label : defaultLabel();
    const path = plistPath(label);
    const present = existsSync(path);
    if (ctx.json) {
      console.log(JSON.stringify({ label, path, present, plist: present ? buildPlist({ label, binaryPath: binaryPath(), args: ['watch', 'run'] }) : null }, null, 2));
      return;
    }
    console.log(`Label:  ${label}`);
    console.log(`Plist:  ${path} (${present ? 'present' : 'missing'})`);
    if (!present) console.log('Run: antchat watch install');
    return;
  }

  console.error(`antchat watch: unknown sub-command '${sub}'.`);
  help();
}
