#!/usr/bin/env bun
// antchat — lightweight ANT chat client.
//
// Standalone binary built via `bun build --compile`. Reuses the main `cli/lib`
// for network and config so antchat's room tokens are interchangeable with
// `~/.ant/config.json` from the full `ant` CLI on the same host.
//
// v0.1.0 surface (this file):
//   antchat join <share-string>     # exchange invite for a room token
//   antchat rooms                   # list joined rooms with handles
//   antchat msg <id> [@h] "text"    # one-shot message into a room
//   antchat chat <id>               # interactive chat (WS4B)
//   antchat open <id>               # open the room URL in a browser (WS4B)
//   antchat tasks <id>              # list/create tasks (WS4B)
//   antchat plan <id>               # plan view (WS4B)
//   antchat mcp <subcommand>        # MCP proxy / install (WS4C)
//   antchat watch install/uninstall # launchd watcher (WS4E)
//   antchat doc / sheet / export    # WS4D (gated on Wave 3)

import { parseArgs } from '../cli/lib/args.js';
import { join as joinRoom } from './commands/join.js';
import { rooms } from './commands/rooms.js';
import { msg } from './commands/msg.js';

const HELP = `
antchat — lightweight ANT chat client (v0.1.0)

Usage: antchat <command> [options]

Commands:
  join <share-string>      Exchange a room invite for a long-lived bearer token.
                           --password X | -p X      Invite password (or set ANT_INVITE_PASSWORD)
                           --handle @name           Identity to claim in the room
                           --label "Stevo's Mac"    Optional human label for ant rooms output
                           --kind cli|web           Token kind (default: cli)

  rooms                    List rooms this client has tokens for.
                           --json                   Machine-readable output

  msg <id> [@handle] "txt"  Post a single message into a room.
                            --msg "text"            Message body (alternative to positional)
                            --handle @name          Pick a non-default handle for this room
                            --json                  Machine-readable output

  chat <id>                Interactive chat over the room SSE stream. (Wave 4B)
  open <id>                Open the room's web URL in your browser.    (Wave 4B)
  tasks <id> [...]         List/create tasks in the room.              (Wave 4B)
  plan <id>                Pretty-print the room's plan view.          (Wave 4B)
  mcp <serve|install|...>  MCP proxy management for Claude Desktop.    (Wave 4C)
  watch <install|...>      launchd watcher for @-mentions.             (Wave 4E)

Global flags:
  --server URL | -s URL    Override server URL (default: from token's server_url)
  --json                   Machine-readable output
  --help | -h              Show this help

Examples:
  antchat join "ant://example.com/r/abc123?invite=xyz789" --password hunter2 --handle @stevo
  antchat rooms
  antchat msg abc123 "hello"
  antchat msg abc123 @james "got a sec?"
`.trim();

const { command, args, flags } = parseArgs(process.argv.slice(2));

if (flags.help || command === 'help' || (!command && !flags.version)) {
  console.log(HELP);
  process.exit(command ? 0 : 1);
}

if (flags.version) {
  console.log('antchat 0.1.0');
  process.exit(0);
}

// antchat resolves the server URL from the token bound to the room argument
// when one isn't passed explicitly. Bare commands like `antchat rooms` fall
// back to a placeholder; `request()` only fires when a token is in play.
const ctx = {
  serverUrl: (typeof flags.server === 'string' ? flags.server : '').trim(),
  apiKey: '',
  json: !!flags.json,
};

async function main() {
  switch (command) {
    case 'join':
    case 'join-room':
      return joinRoom(args, flags, ctx);
    case 'rooms':
      return rooms(args, flags, ctx);
    case 'msg':
      return msg(args, flags, ctx);

    // Stubs for waves still in flight — fail fast with a hint.
    case 'chat':
    case 'open':
    case 'tasks':
    case 'plan':
      console.error(`antchat ${command}: not yet wired (Wave 4B). Track progress in docs/antchat-swarm-plan.md.`);
      process.exit(2);
    case 'mcp':
      console.error('antchat mcp: not yet wired (Wave 4C). Track progress in docs/antchat-swarm-plan.md.');
      process.exit(2);
    case 'watch':
      console.error('antchat watch: not yet wired (Wave 4E). Track progress in docs/antchat-swarm-plan.md.');
      process.exit(2);
    case 'doc':
    case 'sheet':
    case 'export':
      console.error(`antchat ${command}: not yet wired (Wave 4D — needs Wave 3 MCP tools). Track progress in docs/antchat-swarm-plan.md.`);
      process.exit(2);

    default:
      console.error(`antchat: unknown command '${command}'. Run 'antchat --help' for usage.`);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`antchat: ${err?.message || err}`);
  process.exit(1);
});
