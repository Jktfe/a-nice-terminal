/**
 * ant flag — file-refs subsystem CLI (JWPK 2026-05-16).
 *
 * Verbs:
 *   ant flag add <file_path> [--terminal NAME | --chat NAME] [--label TEXT] [--description TEXT]
 *   ant flag list [--terminal NAME | --chat NAME | --path P] [--json]
 *   ant flag remove <id>
 *
 * Default scope is `global` (no --terminal / --chat flag). --terminal and
 * --chat accept name OR id OR handle; they resolve via the shared
 * resolveTerminalIdentifier / resolveChatRoomIdentifier helpers, so the
 * client passes a real session_id / room_id to the server.
 *
 * 9-year-old-readable. Stay under 260 lines.
 */

import {
  makeStandardSendJson,
  resolveChatRoomIdentifier,
  resolveTerminalIdentifier
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
  runtime.writeOut('ant flag <add|list|remove>');
  runtime.writeOut('  flag add <file_path> [--terminal NAME | --chat NAME] [--label TEXT] [--description TEXT]');
  runtime.writeOut('  flag list [--terminal NAME | --chat NAME | --path PATH] [--json]');
  runtime.writeOut('  flag remove <id>');
}

async function resolveScope(flags, runtime, CliInputError) {
  const hasTerminal = typeof flags.terminal === 'string' && flags.terminal.length > 0;
  const hasChat = typeof flags.chat === 'string' && flags.chat.length > 0;
  if (hasTerminal && hasChat) {
    throw new CliInputError('use --terminal OR --chat, not both');
  }
  if (hasTerminal) {
    const terminal = await resolveTerminalIdentifier(runtime, flags.terminal, CliInputError);
    return { scope: 'terminal', target: terminal.sessionId };
  }
  if (hasChat) {
    const room = await resolveChatRoomIdentifier(runtime, flags.chat, CliInputError);
    return { scope: 'chatroom', target: room.id };
  }
  return { scope: 'global', target: null };
}

function formatRefLine(ref) {
  const scopeTag = ref.scope === 'global'
    ? '[global]'
    : `[${ref.scope}:${ref.scopeTarget ?? '?'}]`;
  const labelChunk = ref.label ? ` (${ref.label})` : '';
  return `${ref.id}\t${scopeTag}\t${ref.filePath}${labelChunk}`;
}

async function runAdd(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const filePath = positionals[0];
  if (!filePath) throw new CliInputError('flag add needs a file_path');
  const { scope, target } = await resolveScope(flags, runtime, CliInputError);
  const body = {
    file_path: filePath,
    scope,
    scope_target: target,
    label: flags.label ?? null,
    description: flags.description ?? null,
    flagged_by: '@cli'
  };
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson('/api/file-refs', 'POST', body);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const ref = result?.fileRef ?? {};
    runtime.writeOut(`Flagged ${ref.id ?? '?'}  ${ref.filePath ?? filePath}  [${scope}${target ? `:${target}` : ''}]`);
  }
  return 0;
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const hasPath = typeof flags.path === 'string' && flags.path.length > 0;
  const hasTerminal = typeof flags.terminal === 'string' && flags.terminal.length > 0;
  const hasChat = typeof flags.chat === 'string' && flags.chat.length > 0;
  const usedCount = [hasPath, hasTerminal, hasChat].filter(Boolean).length;
  if (usedCount > 1) {
    throw new CliInputError('use only one of --terminal, --chat, --path');
  }

  let queryString;
  if (hasPath) {
    queryString = `path=${encodeURIComponent(flags.path)}`;
  } else if (hasTerminal) {
    const terminal = await resolveTerminalIdentifier(runtime, flags.terminal, CliInputError);
    queryString = `scope=terminal&target=${encodeURIComponent(terminal.sessionId)}`;
  } else if (hasChat) {
    const room = await resolveChatRoomIdentifier(runtime, flags.chat, CliInputError);
    queryString = `scope=chatroom&target=${encodeURIComponent(room.id)}`;
  } else {
    queryString = 'scope=global';
  }
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/file-refs?${queryString}`, 'GET');
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
    return 0;
  }
  const refs = result?.fileRefs ?? [];
  if (refs.length === 0) {
    runtime.writeOut('(no file-refs in this scope)');
    return 0;
  }
  for (const ref of refs) runtime.writeOut(formatRefLine(ref));
  return 0;
}

async function runRemove(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const id = positionals[0];
  if (!id) throw new CliInputError('flag remove needs an id');
  const sendJson = makeStandardSendJson(runtime);
  await sendJson(`/api/file-refs/${encodeURIComponent(id)}`, 'DELETE');
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ removed: id }));
  } else {
    runtime.writeOut(`Removed file-ref ${id}.`);
  }
  return 0;
}

export async function handleFlagVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  switch (action) {
    case 'add': return runAdd(args, runtime, CliInputError);
    case 'list': return runList(args, runtime, CliInputError);
    case 'remove': return runRemove(args, runtime, CliInputError);
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown flag verb: ${action}`);
  }
}
