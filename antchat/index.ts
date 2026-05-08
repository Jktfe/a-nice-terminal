#!/usr/bin/env bun
// antchat — lightweight ANT chat client.
//
// Standalone binary built via `bun build --compile`. Reuses the main `cli/lib`
// for network and config so antchat's room tokens are interchangeable with
// `~/.ant/config.json` from the full `ant` CLI on the same host.
//
// v0.2.0 surface:
//   antchat join <share-string>     # exchange invite for a room token
//   antchat rooms                   # list joined rooms with handles
//   antchat msg <id> [@h] "text"    # one-shot message into a room
//   antchat chat <id>               # interactive chat (WS4B)
//   antchat open <id>               # open the room URL in a browser (WS4B)
//   antchat tasks <id>              # list/create tasks (WS4B)
//   antchat plan <id>               # plan view (WS4B)
//   antchat mcp <subcommand>        # MCP proxy / install (WS4C)
//   antchat watch install/uninstall # launchd watcher (WS4E)
//   antchat doc <room> <subcmd>     # research-doc cowork (v0.2 — G.2)
//   antchat deck <room> <subcmd>    # presentation cowork w/ file get/put (v0.2 — G.3)
//   antchat sheet <room> <subcmd>   # spreadsheet cowork w/ file get/put (v0.2 — G.4)

import { parseArgs } from '../cli/lib/args.js';
import { join as joinRoom } from './commands/join.js';
import { rooms } from './commands/rooms.js';
import { msg } from './commands/msg.js';
import { chat } from './commands/chat.js';
import { open } from './commands/open.js';
import { tasks } from './commands/tasks.js';
import { plan } from './commands/plan.js';
import { mcp } from './commands/mcp.js';
import { watch } from './commands/watch.js';
import { doc } from './commands/doc.js';
import { deck } from './commands/deck.js';
import { sheet } from './commands/sheet.js';
import { web } from './commands/web.js';

const HELP = `
antchat — lightweight ANT chat client (v0.3.0-alpha.2)

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

  chat <id>                Interactive chat over the room SSE stream.
                           --handle @name          Pick a non-default handle for this room
                           --limit N               Backfill N most recent messages (default 20)
                           --quiet                 Suppress macOS @-mention notifications

  open <id>                Open the room's web URL in your browser.
                           --print                 Print URL only (no launch)

  tasks <id> [sub] [...]   list | create "title" [--desc "..."]
                           accept|review|done|delete <task-id>
                           assign <task-id> @handle

  plan <id>                Pretty-print the room's plan events.
                           --plan-id ID            Override plan id (default ant-r4)
                           --limit N               Cap events returned (default 200)

Cowork (v0.2 — bidirectional editing for humans + agents):

  doc <room> <subcmd>      Research-doc lifecycle (memories K/V + Obsidian mirror).
                           Subcommands: list | get <id> | create <id>
                                        section <id> <secId> | signoff <id> | publish <id>
                           Flags: --title --description --content --heading --author --signed-off

  deck <room> <subcmd>     Presentation cowork (Open-Slide).
                           Subcommands: list | status <slug> | manifest <slug> | audit <slug>
                                        file get <slug> <path> [--out PATH | --json]
                                        file put <slug> <path> [--from-file LOCAL | --content "..."]
                                                                [--base-hash X --if-match-mtime N]

  sheet <room> <subcmd>    Spreadsheet cowork (deck-pattern parity).
                           Same subcommand shape as deck — list/status/manifest/audit/file get/file put.

  Read-modify-write protocol:
    1. file get → captures sha256 + mtime_ms (via stderr / --json envelope).
    2. Modify locally.
    3. file put with --base-hash + --if-match-mtime from step 1.
    4. On 409: re-fetch, merge, retry.

  mcp serve <id>           Run the stdio MCP proxy (Claude Desktop spawn target).
                           --handle @name          Pick a non-default identity
  mcp install <id>         Register the proxy in claude_desktop_config.json.
                           --name antchat-<id>     Override the server key
                           --config /path/to/json  Override config file path
  mcp uninstall <id>       Remove the proxy entry from claude_desktop_config.json.
  mcp print [id]           Emit a JSON snippet (single room or all joined rooms).
  watch run                Foreground @-mention watcher (launchd target).
  watch install            Register + start the LaunchAgent (~/Library/LaunchAgents).
  watch uninstall          Stop + remove the LaunchAgent.
  watch status             Print plist path and presence.

  web [run]                Local browser UI on 127.0.0.1:6459 (v0.3 — non-technical UX).
                           --port N                Port to bind (default 6459)
                           --no-open               Don't auto-open browser
                           install/uninstall/status/open/rotate-token are v0.3.1 stubs.

Global flags:
  --server URL | -s URL    Override server URL (default: from token's server_url)
  --json                   Machine-readable output
  --help | -h              Show this help

Examples:
  antchat join "ant://example.com/r/abc123?invite=xyz789" --password hunter2 --handle @stevo
  antchat msg abc123 "hello"
  antchat doc abc123 list
  antchat deck abc123 file get pitch slides/intro.md   # capture sha+mtime via stderr
  antchat sheet abc123 file put forecast q1.csv --from-file q1.csv \\
    --base-hash <prev-sha> --if-match-mtime <prev-mtime>
`.trim();

const { command, args, flags } = parseArgs(process.argv.slice(2));

if (flags.help || command === 'help' || (!command && !flags.version)) {
  console.log(HELP);
  // Explicit help (`--help`, `help`) exits 0; bare invocation (no args) exits 1.
  process.exit(flags.help || command === 'help' ? 0 : 1);
}

if (flags.version) {
  console.log('antchat 0.3.0-alpha.2');
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
    case 'chat':
      return chat(args, flags, ctx);
    case 'open':
      return open(args, flags, ctx);
    case 'tasks':
      return tasks(args, flags, ctx);
    case 'plan':
      return plan(args, flags, ctx);
    case 'mcp':
      return mcp(args, flags, ctx);
    case 'watch':
      return watch(args, flags, ctx);

    // Cowork commands — bidirectional editing for humans + agents (v0.2).
    case 'doc':
      return doc(args, flags, ctx);
    case 'deck':
      return deck(args, flags, ctx);
    case 'sheet':
      return sheet(args, flags, ctx);
    case 'web':
      return web(args, flags, ctx);

    // `export` was a Wave 4D placeholder; not yet wired.
    case 'export':
      console.error(`antchat export: not yet wired. Track progress in docs/antchat-swarm-plan.md.`);
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
