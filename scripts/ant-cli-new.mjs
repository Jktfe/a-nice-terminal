/**
 * `ant new ...` — create entities (terminal | chat | chatroom).
 *
 * JWPK 2026-05-16 verb spec:
 *   ant new terminal [--name <name>] [--agent-kind claude|codex|pi|gemini|qwen|copilot] [--cwd <path>] [--handle @x]
 *   ant new chat <name>            (alias: chatroom)
 *   ant new chatroom <name>        (alias of `chat`)
 *
 * `new terminal` POSTs /api/terminals — same shape POST /api/terminals
 * accepts, with the auto-register-at-spawn fix that lets terminal chat
 * self-post work from inside the spawned shell.
 *
 * `new chat` POSTs /api/chat-rooms with `{ name }`.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { makeStandardSendJson } from './ant-cli-shared-resolve.mjs';

const BOOLEAN_FLAGS = new Set(['json']);
const KNOWN_AGENT_KINDS = new Set(['claude', 'codex', 'pi', 'gemini', 'qwen', 'copilot']);

export async function handleNewVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  // First positional becomes the name when no --name flag is given.
  let positionalName;
  if (args.length > 0 && !args[0].startsWith('--')) {
    positionalName = args[0];
    args = args.slice(1);
  }
  const flags = parseFlags(args, CliInputError);
  if (positionalName && !flags.name) flags.name = positionalName;

  switch (action) {
    case 'terminal': return runNewTerminal(flags, runtime, CliInputError);
    case 'chat':
    case 'chatroom': return runNewChat(flags, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action ? 0 : 1;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown new verb: ${action}`);
  }
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
      throw new CliInputError(`unexpected positional arg: ${token}`);
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = 'true';
      cursor += 1;
      continue;
    }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliInputError(`flag --${name} needs a value`);
    }
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function writeUsage(runtime) {
  runtime.writeOut('ant new <terminal|chat|chatroom> [name|flags]');
  runtime.writeOut('  new terminal --name NAME [--agent-kind KIND] [--cwd PATH] [--handle @x] [--json]');
  runtime.writeOut('  new chat NAME [--json]               (alias: chatroom)');
  runtime.writeOut('');
  runtime.writeOut('  KIND ∈ { claude, codex, pi, gemini, qwen, copilot }');
}

async function runNewTerminal(flags, runtime, CliInputError) {
  if (!flags.name) {
    throw new CliInputError('--name is required (or pass as first positional)');
  }
  const body = { name: flags.name };
  if (flags['agent-kind']) {
    if (!KNOWN_AGENT_KINDS.has(flags['agent-kind'])) {
      throw new CliInputError(`--agent-kind must be one of: ${[...KNOWN_AGENT_KINDS].join(', ')}`);
    }
    body.agentKind = flags['agent-kind'];
  }
  if (flags.cwd) body.cwd = flags.cwd;
  if (flags.handle) body.handle = flags.handle;
  if (flags.user) body.user = flags.user;

  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson('/api/terminals', 'POST', body);

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    runtime.writeOut(`Spawned terminal ${result.sessionId} ("${result.name}", agentKind=${result.agentKind ?? '(unset)'}).`);
    runtime.writeOut(`  Terminal chat: ${result.linkedChatRoomId}`);
    runtime.writeOut(`  Tmux pane:    ${result.tmuxTargetPane}`);
    runtime.writeOut(`  Derived handle: ${result.derivedHandle}`);
    runtime.writeOut(`Attach with:    tmux attach-session -t ${result.sessionId}`);
  }
  return 0;
}

async function runNewChat(flags, runtime, CliInputError) {
  if (!flags.name) {
    throw new CliInputError('chat name is required (positional or --name)');
  }
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(pathWithPidChain('/api/chat-rooms'), 'POST', { name: flags.name });

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const room = result.chatRoom ?? result;
    runtime.writeOut(`Created chat room "${room.name}" with id ${room.id}.`);
  }
  return 0;
}

function pathWithPidChain(path) {
  const url = new URL(path, 'http://ant.local');
  url.searchParams.set('pidChain', JSON.stringify(processIdentityChain()));
  return `${url.pathname}${url.search}`;
}
