/**
 * `ant memory ...` — CRUD + audit for the memory subsystem (2026-05-16).
 *
 *   ant memory get <key>
 *   ant memory put <key> --value TEXT [--scope global|terminal|room]
 *                        [--target SCOPE_TARGET] [--by HANDLE] [--json]
 *   ant memory list [--prefix P | --terminal NAME | --room NAME]
 *                   [--json]
 *   ant memory delete <key> [--by HANDLE] [--json]
 *   ant memory audit [--key K] [--limit N] [--json]
 *
 * `--terminal NAME` resolves through resolveTerminalIdentifier (id/name/
 * handle/derivedHandle) and lists scope=terminal rows. `--room NAME`
 * resolves through resolveChatRoomIdentifier and lists scope=room rows.
 *
 * 9-year-old-readable. Wraps fetch + JSON in/out — no direct DB access.
 */

import {
  makeStandardSendJson,
  resolveTerminalIdentifier,
  resolveChatRoomIdentifier
} from './ant-cli-shared-resolve.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  const positionals = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      positionals.push(token);
      cursor += 1;
      continue;
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
  return { flags, positionals };
}

function writeUsage(runtime) {
  runtime.writeOut('ant memory <subcommand>');
  runtime.writeOut('  get <key>                                fetch one memory row');
  runtime.writeOut('  put <key> --value TEXT [--scope S] [--target T] [--by HANDLE]');
  runtime.writeOut('  list [--prefix P | --terminal NAME | --room NAME]');
  runtime.writeOut('  delete <key> [--by HANDLE]');
  runtime.writeOut('  audit [--key K] [--limit N]');
}

function formatMemoryLine(memory) {
  const scope = memory.scope ?? 'global';
  const target = memory.scopeTarget ? `:${memory.scopeTarget}` : '';
  return `${memory.key}\t[${scope}${target}]\t${memory.value}`;
}

async function runGet(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const key = positionals[0];
  if (!key) throw new CliInputError('memory get needs a key');
  const sendJson = makeStandardSendJson(runtime);
  const path = `/api/memories/key/${key.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const result = await sendJson(path, 'GET');
    if (flags.json !== undefined) {
      runtime.writeOut(JSON.stringify(result));
    } else {
      runtime.writeOut(formatMemoryLine(result.memory));
    }
    return 0;
  } catch (cause) {
    const message = cause?.message ?? String(cause);
    if (message.includes('404')) {
      runtime.writeOut(`(no memory at ${key})`);
      return 1;
    }
    throw cause;
  }
}

async function runPut(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const key = positionals[0];
  if (!key) throw new CliInputError('memory put needs a key');
  const value = flags.value;
  if (typeof value !== 'string') {
    throw new CliInputError('memory put needs --value TEXT');
  }
  const scope = flags.scope ?? 'global';
  const scopeTarget = flags.target ?? null;
  const byHandle = flags.by ?? null;
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson('/api/memories', 'POST', {
    key,
    value,
    scope,
    scope_target: scopeTarget,
    byHandle
  });
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const verb = result.created ? 'Created' : 'Updated';
    runtime.writeOut(`${verb} memory ${result.memory.key}`);
  }
  return 0;
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const exclusiveCount =
    (flags.prefix !== undefined ? 1 : 0) +
    (flags.terminal !== undefined ? 1 : 0) +
    (flags.room !== undefined ? 1 : 0);
  if (exclusiveCount > 1) {
    throw new CliInputError('use only one of --prefix, --terminal, --room');
  }

  let result;
  const sendJson = makeStandardSendJson(runtime);
  if (flags.terminal !== undefined) {
    const terminal = await resolveTerminalIdentifier(runtime, flags.terminal, CliInputError);
    result = await sendJson(
      `/api/terminals/${encodeURIComponent(terminal.sessionId)}/memories`,
      'GET'
    );
  } else if (flags.room !== undefined) {
    const room = await resolveChatRoomIdentifier(runtime, flags.room, CliInputError);
    result = await sendJson(
      `/api/memories?scope=room&target=${encodeURIComponent(room.id)}`,
      'GET'
    );
  } else {
    const prefixParam =
      flags.prefix !== undefined ? `?prefix=${encodeURIComponent(flags.prefix)}` : '';
    result = await sendJson(`/api/memories${prefixParam}`, 'GET');
  }
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    for (const memory of result.memories ?? []) {
      runtime.writeOut(formatMemoryLine(memory));
    }
  }
  return 0;
}

async function runDelete(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const key = positionals[0];
  if (!key) throw new CliInputError('memory delete needs a key');
  const path = `/api/memories/key/${key.split('/').map(encodeURIComponent).join('/')}${
    flags.by ? `?byHandle=${encodeURIComponent(flags.by)}` : ''
  }`;
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, { method: 'DELETE' });
  if (response.status === 204) {
    if (flags.json !== undefined) {
      runtime.writeOut(JSON.stringify({ deleted: true, key }));
    } else {
      runtime.writeOut(`Deleted ${key}`);
    }
    return 0;
  }
  if (response.status === 404) {
    runtime.writeOut(`(no memory at ${key})`);
    return 1;
  }
  const text = await response.text().catch(() => '');
  throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
}

async function runAudit(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const params = new URLSearchParams();
  if (flags.key) params.set('key', flags.key);
  if (flags.limit) params.set('limit', flags.limit);
  const query = params.toString();
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/memories/audit${query ? `?${query}` : ''}`, 'GET');
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    for (const row of result.audit ?? []) {
      runtime.writeOut(
        `${new Date(row.atMs).toISOString()}\t${row.action}\t${row.memoryKey}\t${row.byHandle ?? '-'}`
      );
    }
  }
  return 0;
}

export async function handleMemoryVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  switch (action) {
    case 'get': return runGet(args, runtime, CliInputError);
    case 'put': return runPut(args, runtime, CliInputError);
    case 'list': return runList(args, runtime, CliInputError);
    case 'delete': return runDelete(args, runtime, CliInputError);
    case 'audit': return runAudit(args, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown memory verb: ${action}`);
}
