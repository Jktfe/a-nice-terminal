// antchat mcp — launch / install / inspect the stdio MCP proxy.
//
// `antchat mcp serve <id>`     — long-running stdio loop (this is what
//                                Claude Desktop's mcpServers.command points
//                                at). Never returns; abort with Ctrl+C.
//
// `antchat mcp install <id>`   — registers `antchat-<id>` in Claude Desktop's
//                                claude_desktop_config.json. Idempotent;
//                                rerunning overwrites the existing entry.
//
// `antchat mcp uninstall <id>` — removes the entry.
//
// `antchat mcp print [id]`     — prints the JSON snippet you'd paste into a
//                                non-Claude MCP client. With no id, prints
//                                one entry per joined room.

import { realpathSync } from 'fs';
import { runProxy } from '../lib/proxy.js';
import { config } from '../../cli/lib/config.js';
import {
  desktopConfigPath,
  readDesktopConfig,
  writeDesktopConfig,
  upsertServer,
  removeServer,
  defaultServerName,
  type McpServerEntry,
} from '../lib/desktop-config.js';

function help(): never {
  console.error([
    'Usage:',
    '  antchat mcp serve <room-id> [--handle @name]',
    '  antchat mcp install <room-id> [--handle @name] [--name antchat-<id>]',
    '  antchat mcp uninstall <room-id> [--name antchat-<id>]',
    '  antchat mcp print [room-id] [--handle @name]',
  ].join('\n'));
  process.exit(1);
}

/** Resolve the path to the running antchat binary so install can pin it. */
function binaryPath(): string {
  // process.execPath is the bun/node interpreter; argv[1] is the script we
  // were launched with. Compiled binaries report execPath as themselves and
  // argv[1] as `--bunfs/...`, so prefer execPath when it exists outside
  // ~/.bun and ~/.nvm — otherwise fall back to argv[0].
  const exec = process.execPath;
  const looksInterpretive = /\/(?:bun|node)\b/.test(exec) && !/antchat$/.test(exec);
  const guess = looksInterpretive ? (process.argv[1] || exec) : exec;
  try { return realpathSync(guess); }
  catch { return guess; }
}

function buildServerEntry(roomId: string, handleFlag: string | undefined): McpServerEntry {
  const args = ['mcp', 'serve', roomId];
  if (handleFlag) args.push('--handle', handleFlag);
  return { command: binaryPath(), args };
}

export async function mcp(args: string[], flags: any, ctx: any) {
  const sub = args[0];
  const roomId = args[1];

  if (!sub) help();
  const handleFlag = typeof flags.handle === 'string' ? flags.handle : undefined;

  if (sub === 'serve') {
    if (!roomId) help();
    await runProxy({
      roomId,
      handleFlag,
      serverUrlOverride: ctx.serverUrl || undefined,
    });
    return;
  }

  if (sub === 'install') {
    if (!roomId) help();
    const tok = config.getRoomToken(roomId, handleFlag);
    if (!tok) {
      console.error(`antchat mcp install: no token for room ${roomId}. Run: antchat join ...`);
      process.exit(1);
    }
    const cfgPath = typeof flags.config === 'string' ? flags.config : desktopConfigPath();
    const name = typeof flags.name === 'string' ? flags.name : defaultServerName(roomId);
    const entry = buildServerEntry(roomId, handleFlag);
    const current = readDesktopConfig(cfgPath);
    const next = upsertServer(current, name, entry);
    writeDesktopConfig(next, cfgPath);
    if (ctx.json) {
      console.log(JSON.stringify({ ok: true, name, path: cfgPath, entry }));
      return;
    }
    console.log(`Installed MCP server '${name}' in ${cfgPath}`);
    console.log(`  command: ${entry.command}`);
    console.log(`  args:    ${entry.args?.join(' ') ?? ''}`);
    console.log('Restart Claude Desktop to pick up the change.');
    return;
  }

  if (sub === 'uninstall') {
    if (!roomId) help();
    const cfgPath = typeof flags.config === 'string' ? flags.config : desktopConfigPath();
    const name = typeof flags.name === 'string' ? flags.name : defaultServerName(roomId);
    const current = readDesktopConfig(cfgPath);
    const { config: next, removed } = removeServer(current, name);
    if (!removed) {
      if (ctx.json) { console.log(JSON.stringify({ ok: false, name, path: cfgPath, removed: false })); return; }
      console.log(`No MCP server named '${name}' in ${cfgPath} — nothing to do.`);
      return;
    }
    writeDesktopConfig(next, cfgPath);
    if (ctx.json) { console.log(JSON.stringify({ ok: true, name, path: cfgPath, removed: true })); return; }
    console.log(`Removed MCP server '${name}' from ${cfgPath}.`);
    console.log('Restart Claude Desktop to pick up the change.');
    return;
  }

  if (sub === 'print') {
    if (roomId) {
      const tok = config.getRoomToken(roomId, handleFlag);
      if (!tok) {
        console.error(`antchat mcp print: no token for room ${roomId}. Run: antchat join ...`);
        process.exit(1);
      }
      const name = typeof flags.name === 'string' ? flags.name : defaultServerName(roomId);
      const entry = buildServerEntry(roomId, handleFlag);
      const snippet = { mcpServers: { [name]: entry } };
      console.log(JSON.stringify(snippet, null, 2));
      return;
    }
    // No id — print one entry per joined room (default handle each).
    const all = config.listRoomTokens();
    const servers: Record<string, McpServerEntry> = {};
    for (const [id] of Object.entries(all)) {
      servers[defaultServerName(id)] = buildServerEntry(id, undefined);
    }
    const snippet = { mcpServers: servers };
    console.log(JSON.stringify(snippet, null, 2));
    return;
  }

  console.error(`antchat mcp: unknown sub-command '${sub}'.`);
  help();
}
