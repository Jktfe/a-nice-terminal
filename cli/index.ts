#!/usr/bin/env bun
// ANT v3 CLI — Interactive client for ANT server

import { parseArgs } from './lib/args.js';
import { sessions } from './commands/sessions.js';
import { chat } from './commands/chat.js';
import { terminal } from './commands/terminal.js';
import { search } from './commands/search.js';
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

  terminal <id>         Connect to a terminal session (interactive PTY)
  terminal send <id>    Send a command to a terminal (--cmd "ls -la")

  chat <id>             Open chat session (interactive)
  chat send <id>        Send a message (--msg "hello")
  chat read <id>        Read message history (--limit 50)
  chat reply <id>       Reply to the latest message (--msg "yes do it")

  search <query>        Search across all sessions (FTS5)

  config                Show current config
  config set            Set server URL (--url https://...)

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

  const serverUrl = flags.server || config.get('serverUrl') || 'http://localhost:6458';
  const apiKey = flags.key || config.get('apiKey') || '';

  const ctx = { serverUrl, apiKey, json: !!flags.json };

  try {
    switch (command) {
      case 'sessions': await sessions(args, flags, ctx); break;
      case 'terminal': await terminal(args, flags, ctx); break;
      case 'chat':     await chat(args, flags, ctx); break;
      case 'search':   await search(args, flags, ctx); break;
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
    if (flags.url) config.set('serverUrl', flags.url);
    if (flags.key) config.set('apiKey', flags.key);
    console.log('Config updated');
  } else {
    console.log(JSON.stringify(config.getAll(), null, 2));
  }
}

main();
