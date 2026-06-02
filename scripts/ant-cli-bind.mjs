import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleBindVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === undefined || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action === undefined ? 1 : 0;
  }
  const fullArgs = action.startsWith('--') ? [action, ...args] : args;
  const flags = parseFlags(fullArgs, CliInputError);
  return runBind(flags, runtime, CliInputError);
}

function writeUsage(runtime) {
  runtime.writeOut('ant bind --room ROOM_ID --handle @h --terminal "Friendly Name" [--admin-token TOKEN]');
  runtime.writeOut('ant bind --room ROOM_ID --handle @h --terminal-id t_abc [--admin-token TOKEN]');
}

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
      collected[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const flagValue = rawArgs[cursor + 1];
    if (flagValue === undefined || flagValue.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    collected[flagName] = flagValue;
    cursor += 2;
  }
  return collected;
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value.trim();
}

function loadAdminToken(flags, runtime, CliInputError) {
  const explicit = flags['admin-token'] ?? runtime.adminToken ?? process.env.ANT_ADMIN_TOKEN;
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim();
  const home = runtime.homeDir ?? homedir();
  const secretsPath = join(home, '.ant', 'secrets.env');
  if (!existsSync(secretsPath)) {
    throw new CliInputError('admin token required: pass --admin-token, set ANT_ADMIN_TOKEN, or configure ~/.ant/secrets.env');
  }
  const content = readFileSync(secretsPath, 'utf8');
  const match = content.match(/^ANT_ADMIN_TOKEN=(.+)$/m);
  if (!match) {
    throw new CliInputError('ANT_ADMIN_TOKEN not found in ~/.ant/secrets.env');
  }
  return match[1].trim().replace(/^"|"$/g, '');
}

function normaliseHandle(raw) {
  const trimmed = raw.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

async function fetchTerminals(runtime, adminToken) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/terminals`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET /api/terminals failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.terminals) ? payload.terminals : [];
}

function terminalMatches(record, wanted) {
  const lowerWanted = wanted.toLowerCase();
  return [
    record.sessionId,
    record.name,
    record.handle,
    record.derivedHandle,
    record.tmuxTargetPane
  ].some((value) => typeof value === 'string' && value.toLowerCase() === lowerWanted);
}

async function resolveTerminalId(flags, runtime, adminToken, CliInputError) {
  const explicitId = flags['terminal-id'];
  if (typeof explicitId === 'string' && explicitId.trim().length > 0) return explicitId.trim();
  const terminalName = requireFlag(flags, 'terminal', CliInputError);
  const terminals = await fetchTerminals(runtime, adminToken);
  const matches = terminals.filter((record) => terminalMatches(record, terminalName));
  if (matches.length === 0) {
    throw new CliInputError(`No terminal matched "${terminalName}". Try the friendly terminal name, handle, or session id.`);
  }
  if (matches.length > 1) {
    throw new CliInputError(`Terminal "${terminalName}" matched ${matches.length} records; use --terminal-id.`);
  }
  return matches[0].sessionId;
}

async function runBind(flags, runtime, CliInputError) {
  const roomId = requireFlag(flags, 'room', CliInputError);
  const handle = normaliseHandle(requireFlag(flags, 'handle', CliInputError));
  if (!flags.terminal && !flags['terminal-id']) {
    throw new CliInputError('missing required flag --terminal or --terminal-id');
  }
  const adminToken = loadAdminToken(flags, runtime, CliInputError);
  const terminalId = await resolveTerminalId(flags, runtime, adminToken, CliInputError);
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/sessions/add`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ room_id: roomId, handle, terminal_id: terminalId })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`bind failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const payload = await response.json();
  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(payload, null, 2));
  } else {
    runtime.writeOut(`Bound ${payload.handle} -> ${payload.terminal_id} in ${payload.room_id}`);
  }
  return 0;
}
