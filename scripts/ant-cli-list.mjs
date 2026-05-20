/**
 * `ant list ...` — listing top-level entities (terminals | chatrooms).
 *
 * JWPK 2026-05-16 verb spec:
 *   ant list terminals [--json]
 *   ant list chatrooms [--json]
 *
 * Plain text mode prints a 1-line-per-entity summary. JSON mode passes
 * the server payload through unchanged.
 */

const BOOLEAN_FLAGS = new Set(['json', 'include-archived']);

export async function handleListVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'terminals': return runListTerminals(flags, runtime);
    case 'chatrooms':
    case 'chats': return runListChatRooms(flags, runtime);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action ? 0 : 1;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown list verb: ${action}`);
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
  runtime.writeOut('ant list <terminals|chatrooms> [--json]');
}

async function runListTerminals(flags, runtime) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/terminals`);
  if (!response.ok) throw new Error(`could not list terminals: ${response.status}`);
  const payload = await response.json();
  const terminals = payload.terminals ?? [];

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  if (terminals.length === 0) {
    runtime.writeOut('No terminals.');
    return 0;
  }
  for (const t of terminals) {
    const aliveTag = t.alive ? 'alive' : 'stopped';
    runtime.writeOut(`${t.sessionId}\t${t.name}\t${t.agentKind ?? '-'}\t${t.derivedHandle ?? '-'}\t${aliveTag}`);
  }
  return 0;
}

async function runListChatRooms(flags, runtime) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/chat-rooms`);
  if (!response.ok) throw new Error(`could not list chat-rooms: ${response.status}`);
  const payload = await response.json();
  const rooms = payload.chatRooms ?? [];

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  if (rooms.length === 0) {
    runtime.writeOut('No chat rooms (terminal chats are intentionally hidden — use `list terminals` to see those).');
    return 0;
  }
  for (const r of rooms) {
    runtime.writeOut(`${r.id}\t${r.name}\t${r.attentionState ?? '-'}`);
  }
  return 0;
}
