#!/usr/bin/env bun
// ANT v3 CLI — Interactive client for ANT server

import { parseArgs } from './lib/args.js';
import { sessions } from './commands/sessions.js';
import { chat } from './commands/chat.js';
import { terminal } from './commands/terminal.js';
import { search } from './commands/search.js';
import { share } from './commands/share.js';
import { qr } from './commands/qr.js';
import { msg } from './commands/msg.js';
import { task } from './commands/task.js';
import { flag } from './commands/flag.js';
import { hooks } from './commands/hooks.js';
import { memory } from './commands/memory.js';
import { agents } from './commands/agents.js';
import { config } from './lib/config.js';

const { command, args, flags } = parseArgs(process.argv.slice(2));

const HELP = `
ANT v3 CLI

Usage: ant <command> [options]

Commands:
  sessions              List all sessions
  sessions create       Create a new session (--name, --type terminal|chat)
  sessions archive <id> Archive a session
  sessions delete <id>  Delete a session
  sessions export <id>  Export session summary to Obsidian vault

  terminal <id>         Connect to a terminal session (interactive PTY)
  terminal send <id>    Send a command to a terminal (--cmd "ls -la")
  terminal watch <id>   Read-only live stream of a terminal
  terminal history <id> Read persisted terminal history from the DB
                        (--since 5m|1h  --grep "error"  --limit 100  --raw)
  terminal events <id>  Read tmux control-mode structured events
                        (--since 15m  --kind layout-change  --limit 50)

  chat <id>             Open chat session (interactive)
  chat send <id>        Send a message (--msg "hello")
  chat read <id>        Read message history (--limit 50)
  chat reply <id>       Reply to the latest message (--msg "yes do it")

  msg <id> "text"       Broadcast a message to all session participants
  msg <id> @handle "t" Send a targeted message to one handle

  task <id> list                    List tasks
  task <id> create "title"          Propose a new task (--desc "...")
  task <id> accept <task-id>        Accept a proposed task
  task <id> assign <task-id> @h     Assign to a handle
  task <id> review <task-id>        Mark as ready for review
  task <id> done <task-id>          Mark complete
  task <id> delete <task-id>        Delete a task

  flag <id> <file>      Flag a file reference in the session (--note "why")
  flag <id> list        List flagged files
  flag <id> remove <r>  Remove a file reference

  share <id>            Generate a read-only share link for a session
  qr                    Show QR code to connect ANTios to this server

  search <query>        Search across all sessions (FTS5)

  memory get <key>            Read one mempalace row by key
  memory put <key> <value>    Upsert one mempalace row (value = JSON or string)
  memory list <prefix>        List all rows under a key prefix (tasks/, agents/…)
  memory search <query>       FTS5 search across all memory
  memory delete <key>         Delete one row by key
                              (see docs/mempalace-schema.md for conventions)

  agents list                 Pretty-print the agent registry (agents/*)
  agents show <id>            Full row for one agent

  hooks install         Install ANT shell capture hooks into ~/.zshrc

  config                Show current config
  config set            Set server URL / API key / handle / session ID
                        (--url https://... --key abc --handle @james --session <id>)

Options:
  --server, -s    Server URL (default: from ~/.ant/config.json)
  --key, -k       API key
  --json          Output as JSON
  --help, -h      Show help
`;

async function main() {
  if (flags.help || !command) {
    console.log(HELP);
    process.exit(0);
  }

  const serverUrl = flags.server || config.get('serverUrl') || 'https://localhost:6458';
  const apiKey = flags.key || config.get('apiKey') || '';

  const ctx = { serverUrl, apiKey, json: !!flags.json };

  try {
    switch (command) {
      case 'sessions': await sessions(args, flags, ctx); break;
      case 'terminal': await terminal(args, flags, ctx); break;
      case 'chat':     await chat(args, flags, ctx); break;
      case 'msg':      await msg(args, flags, ctx); break;
      case 'task':     await task(args, flags, ctx); break;
      case 'flag':     await flag(args, flags, ctx); break;
      case 'search':   await search(args, flags, ctx); break;
      case 'memory':   await memory(args, flags, ctx); break;
      case 'agents':   await agents(args, flags, ctx); break;
      case 'hooks':    await hooks(args.slice(1), flags); break;
      case 'share':    await share(args, flags, ctx); break;
      case 'qr':       await qr(args, flags, ctx); break;
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
    console.log('Config updated');
  } else {
    console.log(JSON.stringify(config.getAll(), null, 2));
  }
}

main();
