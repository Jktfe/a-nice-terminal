#!/usr/bin/env bun
// ANT v3 CLI — Interactive client for ANT server

import { parseArgs } from './lib/args.js';
import { sessions } from './commands/sessions.js';
import { chat } from './commands/chat.js';
import { terminal } from './commands/terminal.js';
import { search } from './commands/search.js';
import { share } from './commands/share.js';
import { msg } from './commands/msg.js';
import { ask, question } from './commands/ask.js';
import { deck } from './commands/deck.js';
import { sheet } from './commands/sheet.js';
import { task } from './commands/task.js';
import { plan } from './commands/plan.js';
import { flag } from './commands/flag.js';
import { hooks } from './commands/hooks.js';
import { memory } from './commands/memory.js';
import { doc } from './commands/doc.js';
import { agents } from './commands/agents.js';
import { prompt } from './commands/prompt.js';
import { grant } from './commands/grant.js';
import { interview } from './commands/interview.js';
import { register as registerIdentity } from './commands/register.js';
import { joinRoom } from './commands/joinRoom.js';
import { evidence } from './commands/evidence.js';
import { config } from './lib/config.js';
import { identitySourceLabel, resolveIdentityDetails, resolveIdentityDetailsAsync } from './lib/identity.js';

const { command, args, flags } = parseArgs(process.argv.slice(2));

const HELP = `
ANT v3 CLI

Usage: ant <command> [options]

Commands:
  sessions              List all sessions
  sessions create       Create a new session (--name, --type terminal|chat)
  sessions archive <id> Archive a session
  sessions delete <id>  Delete a session
  sessions export <id>  Export session evidence
                        (--target obsidian|open-slide|all)

  evidence screenshot <session-id>
                        Capture screenshot and emit run_event
                        (--dir /path to override output directory)
  evidence visual-baseline <session-id>
                        Run visual-QA capture script and emit run_event
                        (--base-url http://localhost:5173 --dir /path)

  terminal <id>         Connect to a terminal session (interactive PTY)
  terminal send <id>    Send a command to a terminal (--cmd "ls -la")
  terminal watch <id>   Read-only live stream of a terminal
  terminal history <id> Read persisted terminal history from the DB
                        (--since 5m|1h  --grep "error"  --limit 100  --raw)
  terminal events <id>  Read tmux control-mode structured events
                        (--since 15m  --kind layout-change  --limit 50)
  terminal key <id> <n> Send a special key to a terminal
                        (ctrl-c, enter, tab, shift-tab, up, down, left, right, escape)

  chat <id>             Open chat session (interactive)
  chat send <id>        Send a message (--msg "hello")
                        Share a file (--file /path --to @handle --msg "note")
                        Auto-detects server and identity in normal ANT shells
  chat read <id>        Read message history (--limit 50)
  chat reply <id>       Reply to the latest message (--msg "yes do it")
  chat pending <id>     Show pending interactive prompt for a terminal/linked chat
  chat decide <id>      Approve/deny/respond to a prompt with justification
                        (approve|deny|yes|no|retry|abort|text|select --why "...")
  chat leave <id>       Remove this terminal/agent from a chatroom
                        (--session <id> or --handle @name to override identity)
  chat focus <id>       Queue normal room messages for a participant
                        (--handle @name|--session <id> --ttl 30m --reason "building")
  chat unfocus <id>     Exit focus mode and deliver one server digest
                        (--handle @name|--session <id>)

  msg <id> "text"       Broadcast a message to all session participants
  msg <id> @handle "t" Send a targeted message to one handle

  ask list              List active asks across rooms (--status all|open,candidate)
  ask <room> "question" Open an ask/action item for a room
                        (--to @handle --owner agent|human|terminal|room --priority high)
  ask show <ask-id>     Show full ask context
  ask answer <ask-id>   Resolve an ask (approve|reject|defer|dismiss --msg "...")
                        Use --session <room-id> when relying on a room token
  ask nudge <ask-id>    Post a paste-ready answer-snippet into the ask's room
                        (--dry-run prints the snippet locally instead)
  ask outstanding       Print all open asks as paste-ready CLI snippets
                        (--to @handle to filter)
  chat ask <id>         Alias for opening an ask in a chatroom

  interview send <id>   Reply to an interview as the current ANT session
                        (--msg "reply" --session <room-id> for room-token auth)
  interview summary <id>
                        Post the final interview summary back to the room
                        (--msg "summary" --session <room-id>)

  grant list             List consent grants (--to @handle --room <id> --status active)
  grant create           Create a consent grant (--topic file-read --to @handle
                        --room <id> --duration 1h --max-answers 5 --source a.ts,b.ts)
  grant show <id>        Show a single grant (--room <id>)
  grant revoke <id>      Revoke a grant (--room <id>)

  question "text" --room <id> [--to @h] [--recommend "..."]
                        One-shot: add a question to a room's sidebar.
                        Alias for: ant ask <room-id> "text".

  deck list             List Open-Slide decks visible to this caller
  deck status <slug>    Show manifest, source, and file snapshot hashes
                        (--session <room-id> to use a room token)
  deck manifest <slug>  Print the raw .ant-deck.json manifest
  deck audit <slug>     Show deck audit events (--limit 50)
  deck file get <slug> <path>
                        Read a deck file; prints content + sha + mtime
                        (--out PATH to save · --json for agent envelope)
  deck file put <slug> <path>
                        Write a deck file with concurrency guard
                        (--from-file LOCAL | --content "..."
                         --base-hash X --if-match-mtime N
                         · 409 surfaces sha/mtime for re-fetch + retry)

  sheet list            List Open-Slide spreadsheets visible to this caller
  sheet status <slug>   Show manifest + file snapshot hashes (deck-parity)
  sheet manifest <slug> Print the raw .ant-sheet.json manifest
  sheet audit <slug>    Show sheet audit events (--limit 50)
  sheet file get <slug> <path>
                        Read a sheet file (use --out for xlsx binary)
  sheet file put <slug> <path>
                        Write a sheet file with the same concurrency guard
                        as deck file put — see deck section for flags.

  task <id> list                    List tasks
  task <id> create "title"          Propose a new task (--desc "...")
  task <id> accept <task-id>        Accept a proposed task
  task <id> assign <task-id> @h     Assign to a handle
  task <id> review <task-id>        Mark as ready for review
  task <id> done <task-id>          Mark complete
  task <id> delete <task-id>        Delete a task

  plan list                         List all known plans (plan_id, session, event count)
                                    (--include-archived to show hidden plans)
  plan show <plan_id>               Show milestones + tests with latest status
                                    (--session <id> to disambiguate; --limit N events)
  plan archive <plan_id>            Hide a plan from default plan lists
                                    (--session <id> to disambiguate)
  plan unarchive <plan_id>          Restore an archived plan to default lists
                                    (--session <id> to disambiguate)

  flag <id> <file>      Flag a file reference in the session (--note "why")
  flag <id> list        List flagged files
  flag <id> remove <r>  Remove a file reference

  share <id>            Generate a read-only share link for a session
  qr                    Show QR code to connect ANTios to this server

  join-room <share>     Exchange an invite password for a room token
                        (--password X --handle @name --kind cli|mcp|web)

  search <query>        Search across all sessions (FTS5)

  memory get <key>            Read one mempalace row by key
  memory put <key> <value>    Upsert one mempalace row (value = JSON or string)
  memory list <prefix>        List all rows under a key prefix (tasks/, agents/…)
  memory search <query>       FTS5 search operational memory (--all for archives too)
  memory audit                Report duplicate, oversize, and noisy memory rows
  memory delete <key>         Delete one row by key
                              (see docs/mempalace-schema.md for conventions;
                               for research docs prefer 'ant doc' — it goes
                               through the doc API + Obsidian mirror.)

  doc create <id>             Create a research doc (--title "..." [--description ...] [--author @x])
  doc get <id>                Read a research doc rendered as markdown
  doc list                    List all research docs
  doc section <id> <secId>    Add or update a section
                              (--heading "..." --content "..." [--author @x] [--signed-off])
  doc signoff <id>            Sign off as one of the authors (--author @x)
  doc publish <id>            Publish (--author @x)
                              (Stored in memories K/V at docs/<id>; mirrored to
                               $ANT_OBSIDIAN_VAULT/research/<id>.md. See
                               docs/ant-agent-feature-protocols.md Section 12.)

  agents list                 Pretty-print the agent registry (agents/*)
  agents show <id>            Full row for one agent

  prompt config               Show/configure generic prompt bridge
                        (--enable --target linked|chat:<id>|webhook:<url>)
  prompt pending <id>         Show pending prompt bridge event for a terminal
  prompt respond <id>         Inject a raw prompt response (--text "yes")

  hooks install         Install ANT shell capture hooks into ~/.zshrc
  hooks install <cli>   Stage per-CLI status hook templates in
                        ~/.<cli>/hooks/ant-status/ for one of:
                        claude-code, codex-cli, gemini-cli, qwen-cli,
                        copilot-cli, pi (--dry-run prints planned writes)

  whoami                Show the identity ANT will stamp on outbound chat
                        (--external, --from, --session, or --handle)
  register              Register this shell's parent process to a handle
                        (--handle @name, optional --ttl 12h, --chain for nested shells)

  config                Show current config
  config set            Set server URL / API key / handle / session ID
                        (--url https://... --key abc --handle @myhandle --session <id>)

Options:
  --server, -s    Server URL override (default: ANT_SERVER_URL / ANT_SERVER / config / https://localhost:6458)
  --key, -k       API key
  --external      Force external mode (skip native tmux auto-detection)
  --json          Output as JSON
  --help, -h      Show help
`;

async function main() {
  if (flags.help || !command) {
    console.log(HELP);
    process.exit(0);
  }

  const serverUrl = flags.server
    || process.env.ANT_SERVER_URL
    || process.env.ANT_SERVER
    || config.get('serverUrl')
    || `https://localhost:${process.env.ANT_PORT || '6458'}`;
  const apiKey = flags.key || config.get('apiKey') || '';

  const ctx = { serverUrl, apiKey, json: !!flags.json };

  try {
    switch (command) {
      case 'sessions': await sessions(args, flags, ctx); break;
      case 'terminal': await terminal(args, flags, ctx); break;
      case 'chat':     await chat(args, flags, ctx); break;
      case 'msg':      await msg(args, flags, ctx); break;
      case 'ask':      await ask(args, flags, ctx); break;
      case 'grant':     await grant(args, flags, ctx); break;
      case 'interview': await interview(args, flags, ctx); break;
      case 'question': await question(args, flags, ctx); break;
      case 'deck':     await deck(args, flags, ctx); break;
      case 'sheet':    await sheet(args, flags, ctx); break;
      case 'task':     await task(args, flags, ctx); break;
      case 'plan':     await plan(args, flags, ctx); break;
      case 'flag':     await flag(args, flags, ctx); break;
      case 'search':   await search(args, flags, ctx); break;
      case 'memory':   await memory(args, flags, ctx); break;
      case 'doc':      await doc(args, flags, ctx); break;
      case 'agents':   await agents(args, flags, ctx); break;
      case 'prompt':   await prompt(args, flags, ctx); break;
      case 'hooks':    await hooks(args, flags); break;
      case 'register': await registerIdentity(args, flags, ctx); break;
      case 'join-room': await joinRoom(args, flags, ctx); break;
      case 'share':    await share(args, flags, ctx); break;
      case 'evidence': await evidence(args, flags, ctx); break;
      case 'qr':       await (await import('./commands/qr.js')).qr(args, flags, ctx); break;
      case 'whoami':   await whoamiCmd(flags, ctx); break;
      case 'config':   configCmd(args, flags); break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

function configCmd(args: string[], flags: Record<string, any>) {
  if (args[0] === 'set') {
    if (flags.url)     config.set('serverUrl', flags.url);
    if (flags.key)     config.set('apiKey', flags.key);
    if (flags.handle)  config.set('handle', flags.handle.startsWith('@') ? flags.handle : `@${flags.handle}`);
    if (flags.session) config.set('sessionId', flags.session);
    const identity = resolveIdentityDetails(!!flags.external);
    console.log(`Config updated. Chat will post as ${identity.senderId} (${identitySourceLabel(identity.source)}).`);
  } else {
    console.log(JSON.stringify(config.getAll(), null, 2));
  }
}

async function whoamiCmd(flags: Record<string, any>, ctx: { serverUrl: string; apiKey?: string; json?: boolean }) {
  const identity = await resolveIdentityDetailsAsync(ctx as any, !!flags.external, {
    from: typeof flags.from === 'string' ? flags.from : undefined,
    sessionId: typeof flags.session === 'string' ? flags.session : undefined,
    handle: typeof flags.handle === 'string' ? flags.handle : undefined,
  });
  const payload = {
    posting_as: identity.senderId,
    source: identity.source,
    source_label: identitySourceLabel(identity.source),
    native_session_id: identity.native.sessionId,
    handle: identity.handle || null,
    display_name: identity.displayName || null,
    pid: identity.pid || null,
    configured_handle: identity.configuredHandle,
    configured_session_id: identity.configuredSessionId,
    server_url: ctx.serverUrl,
    config_file: config.path,
  };

  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Posting as: ${payload.posting_as}`);
  console.log(`Source: ${payload.source_label}`);
  if (payload.handle) console.log(`Handle: ${payload.handle}`);
  if (payload.display_name) console.log(`Display name: ${payload.display_name}`);
  if (payload.pid) console.log(`Registered PID: ${payload.pid}`);
  if (payload.native_session_id) console.log(`Native session: ${payload.native_session_id}`);
  console.log(`Configured handle: ${payload.configured_handle || '(unset)'}`);
  console.log(`Configured session: ${payload.configured_session_id || '(unset)'}`);
  console.log(`Server: ${payload.server_url}`);
  console.log(`Config file: ${payload.config_file}`);
}

main();
