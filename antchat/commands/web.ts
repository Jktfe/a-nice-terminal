// antchat web — local browser UI for non-technical users.
//
// Subcommand surface:
//   antchat web [run]        — foreground server on 127.0.0.1:6459
//   antchat web install      — write LaunchAgent plist + bootstrap it; mints
//                              a launch token in macOS Keychain so the URL
//                              bookmark survives daemon restarts
//   antchat web uninstall    — bootout + remove plist (token stays unless
//                              --purge-keychain is passed)
//   antchat web status       — plist presence + Keychain presence + /healthz
//   antchat web open         — open the running daemon's URL in the browser
//   antchat web rotate-token — re-mint the Keychain launch token (use if a
//                              token is suspected stolen)

import { realpathSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  buildPlist,
  writePlist,
  removePlist,
  loadAgent,
  unloadAgent,
  plistPath,
} from '../lib/launchd.js';
import { createWebServer } from '../web/server.js';
import {
  mintLaunchToken,
  keychain,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
} from '../web/auth.js';

declare const Bun: any;

const DEFAULT_PORT = 6459;
const DAEMON_LABEL = 'com.jktfe.antchat.web';

function help(): never {
  console.error([
    'Usage:',
    '  antchat web [run]              — launch a local browser UI on 127.0.0.1:6459',
    '  antchat web install            — install LaunchAgent for autostart at login',
    '  antchat web uninstall          — remove LaunchAgent (--purge-keychain to drop token)',
    '  antchat web status             — report daemon health',
    '  antchat web open               — open the running daemon in a browser',
    '  antchat web rotate-token       — re-mint the Keychain launch token',
    '',
    'Flags:',
    '  --port <n>                     Port to bind on 127.0.0.1 (default 6459)',
    '  --no-open                      Do not auto-open browser',
    '  --launch-token-from-keychain   Use the daemon-mode token (read-only flag for launchd)',
    '  --purge-keychain               (uninstall) drop the stored launch token',
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

function parsePort(flags: any): number {
  const raw = flags.port;
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : DEFAULT_PORT;
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    console.error(`antchat web: invalid --port ${raw}`);
    process.exit(1);
  }
  return n;
}

// ─── run ───────────────────────────────────────────────────────────────────

async function runForeground(flags: any): Promise<void> {
  const port = parsePort(flags);

  // Daemon mode reads the token from Keychain so the URL bookmark survives
  // restarts. Foreground mode mints a fresh token each run.
  let launchToken: string;
  if (flags['launch-token-from-keychain']) {
    try { launchToken = await keychain.readOrMintLaunchToken(); }
    catch (err: any) {
      console.error(`antchat web: Keychain read failed — ${err?.message || err}`);
      process.exit(1);
    }
  } else {
    launchToken = mintLaunchToken();
  }

  let handle;
  try {
    handle = createWebServer({ port, launchToken });
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE' || /address already in use/i.test(err?.message || '')) {
      console.error(`antchat web: port ${port} is already in use. Pick another with --port.`);
      process.exit(1);
    }
    throw err;
  }

  const url = `http://127.0.0.1:${port}/#token=${launchToken}`;
  console.log(`antchat web ready at ${url}`);

  // pbcopy is best-effort — never block the boot path on it.
  try {
    const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
    proc.stdin.write(url);
    await proc.stdin.end();
  } catch { /* not on PATH */ }

  if (!flags['no-open']) {
    try { Bun.spawn(['open', url]); }
    catch { /* not on PATH */ }
  }

  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nantchat web shutting down…');
    try { await handle.close(); }
    finally { process.exit(0); }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await new Promise<void>(() => { /* block forever — Bun.serve handles requests */ });
}

// ─── install ───────────────────────────────────────────────────────────────

async function installDaemon(flags: any, ctx: any): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error('antchat web install: macOS-only.');
    process.exit(1);
  }
  const port = parsePort(flags);
  const label = DAEMON_LABEL;

  // Ensure a Keychain token exists before we boot launchd so the daemon's
  // first run reads it cleanly without a prompt-during-boot race.
  const launchToken = await keychain.readOrMintLaunchToken();

  const args = ['web', 'run', '--port', String(port), '--no-open', '--launch-token-from-keychain'];
  const env: Record<string, string> = {};
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

  const url = `http://127.0.0.1:${port}/#token=${launchToken}`;
  if (ctx.json) {
    console.log(JSON.stringify({ ok, label, path, port, url, attempts }, null, 2));
    return;
  }

  console.log(`Wrote ${path}`);
  for (const a of attempts) {
    const tag = a.ok ? 'ok' : 'fail';
    console.log(`  ${a.cmd} -> ${tag}${a.stderr ? `: ${a.stderr.trim()}` : ''}`);
    if (a.ok) break;
  }
  if (!ok) {
    console.error('antchat web install: launchctl failed. Plist remains; rerun once fixed.');
    process.exit(2);
  }
  console.log(`LaunchAgent ${label} bootstrapped on 127.0.0.1:${port}.`);
  console.log(`Open URL:   ${url}`);
  console.log(`Bookmark it — the token persists across restarts via Keychain.`);
}

// ─── uninstall ─────────────────────────────────────────────────────────────

async function uninstallDaemon(flags: any, ctx: any): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error('antchat web uninstall: macOS-only.');
    process.exit(1);
  }
  const label = DAEMON_LABEL;
  const attempts = await unloadAgent(label);
  const removed = removePlist(label);

  let purgedKeychain = false;
  if (flags['purge-keychain']) {
    try {
      await keychain.del(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      purgedKeychain = true;
    } catch (err: any) {
      console.error(`antchat web uninstall: Keychain purge failed — ${err?.message || err}`);
    }
  }

  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, label, removed, purgedKeychain, attempts }, null, 2));
    return;
  }
  for (const a of attempts) {
    const tag = a.ok ? 'ok' : 'fail';
    console.log(`  ${a.cmd} -> ${tag}${a.stderr ? `: ${a.stderr.trim()}` : ''}`);
    if (a.ok) break;
  }
  console.log(removed ? `Removed plist ${plistPath(label)}` : `No plist at ${plistPath(label)}`);
  if (flags['purge-keychain']) {
    console.log(purgedKeychain ? 'Dropped Keychain launch token.' : 'Keychain purge failed (see stderr).');
  } else {
    console.log('Keychain launch token retained. Pass --purge-keychain to drop it.');
  }
}

// ─── status ────────────────────────────────────────────────────────────────

async function statusDaemon(flags: any, ctx: any): Promise<void> {
  const label = DAEMON_LABEL;
  const path = plistPath(label);
  const present = existsSync(path);
  const port = parsePort(flags);

  let keychainPresent = false;
  try { keychainPresent = (await keychain.get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)) !== null; }
  catch { /* user denied keychain — treat as unknown */ }

  let healthz: { reachable: boolean; status?: number; uptime?: number; version?: string } = { reachable: false };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as any;
      healthz = { reachable: true, status: res.status, uptime: body?.uptime, version: body?.version };
    } else {
      healthz = { reachable: false, status: res.status };
    }
  } catch { /* not running or port mismatch */ }

  if (ctx.json) {
    console.log(JSON.stringify({ label, plist: { path, present }, port, keychainPresent, healthz }, null, 2));
    return;
  }
  console.log(`Label:    ${label}`);
  console.log(`Plist:    ${path} (${present ? 'present' : 'missing'})`);
  console.log(`Keychain: ${keychainPresent ? 'present' : 'missing'} (service ${KEYCHAIN_SERVICE})`);
  console.log(`Port:     ${port}`);
  console.log(healthz.reachable
    ? `Health:   /healthz 200 — version ${healthz.version}, uptime ${healthz.uptime}s`
    : `Health:   /healthz unreachable on 127.0.0.1:${port}`);
  if (!present) console.log('\nRun: antchat web install');
  else if (!healthz.reachable) console.log('\nDaemon present but unreachable. Check ~/Library/Logs/com.jktfe.antchat.web.err.log');
}

// ─── open ──────────────────────────────────────────────────────────────────

async function openDaemon(flags: any): Promise<void> {
  const port = parsePort(flags);
  const launchToken = await keychain.get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (!launchToken) {
    console.error('antchat web open: no Keychain launch token. Run: antchat web install');
    process.exit(1);
  }
  // Sanity check the daemon is actually serving.
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`healthz ${res.status}`);
  } catch (err: any) {
    console.error(`antchat web open: daemon not reachable on 127.0.0.1:${port} — ${err?.message || err}`);
    console.error('Run: antchat web status   (or install if it is missing)');
    process.exit(1);
  }
  const url = `http://127.0.0.1:${port}/#token=${launchToken}`;
  try { Bun.spawn(['open', url]); }
  catch { console.log(url); return; }
  console.log(url);
}

// ─── rotate-token ──────────────────────────────────────────────────────────

async function rotateToken(_flags: any, ctx: any): Promise<void> {
  const next = await keychain.rotateLaunchToken();
  // Restart the daemon if it's loaded so the new token is in effect.
  let restarted = false;
  try {
    const attempts = await unloadAgent(DAEMON_LABEL);
    if (attempts.some((a) => a.ok)) {
      const reload = await loadAgent(DAEMON_LABEL);
      restarted = reload.some((a) => a.ok);
    }
  } catch { /* daemon wasn't loaded; new token will apply on next install/start */ }

  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, restarted, token_preview: next.slice(0, 8) + '…' }, null, 2));
    return;
  }
  console.log(`Rotated Keychain launch token (preview: ${next.slice(0, 8)}…).`);
  console.log(restarted
    ? 'Daemon restarted; the new token is in effect.'
    : 'Daemon was not loaded — new token will apply on next install/start.');
}

// ─── dispatcher ────────────────────────────────────────────────────────────

export async function web(args: string[], flags: any, ctx: any): Promise<void> {
  const sub = args[0];
  if (!sub || sub === 'run') return runForeground(flags);
  if (sub === '--help' || sub === '-h') return help();

  switch (sub) {
    case 'install':       return installDaemon(flags, ctx);
    case 'uninstall':     return uninstallDaemon(flags, ctx);
    case 'status':        return statusDaemon(flags, ctx);
    case 'open':          return openDaemon(flags);
    case 'rotate-token':  return rotateToken(flags, ctx);
    default:
      console.error(`antchat web: unknown subcommand "${sub}"`);
      help();
  }
}
