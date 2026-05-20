/**
 * ant settings — manage scope-aware shortcuts (terminal / chatroom / global).
 *
 * Verbs:
 *   ant settings addterminalshortcut --terminal NAME --label LBL --command CMD
 *   ant settings addchatroomshortcut --chat NAME --label LBL --command CMD
 *   ant settings listshortcuts [--terminal NAME | --chat NAME]
 *   ant settings removeshortcut <id>
 *
 * Terminal / chat names are resolved client-side via the shared
 * ant-cli-shared-resolve helpers, so the CLI is name-aware end-to-end.
 * No flag = `listshortcuts` returns the global bucket.
 *
 * 9-year-old-readable. Mirrors the parseFlags / writeJsonOrText shape used
 * by ant-cli-hooks.mjs and ant-cli-chair.mjs.
 */

import {
  resolveTerminalIdentifier,
  resolveChatRoomIdentifier
} from './ant-cli-shared-resolve.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleSettingsVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const { flags, positionals } = parseFlags(args, CliInputError);
  switch (action) {
    case 'addterminalshortcut':
      return runAddTerminalShortcut(flags, runtime, CliInputError);
    case 'addchatroomshortcut':
      return runAddChatroomShortcut(flags, runtime, CliInputError);
    case 'listshortcuts':
      return runListShortcuts(flags, runtime, CliInputError);
    case 'removeshortcut':
      return runRemoveShortcut(positionals, flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown settings verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  const positionals = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
      positionals.push(token);
      cursor += 1;
      continue;
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
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
  runtime.writeOut('ant settings <verb> [flags]');
  runtime.writeOut('');
  runtime.writeOut('  addterminalshortcut --terminal NAME --label LBL --command CMD');
  runtime.writeOut('  addchatroomshortcut --chat NAME --label LBL --command CMD');
  runtime.writeOut('  listshortcuts [--terminal NAME | --chat NAME]');
  runtime.writeOut('  removeshortcut <id>');
}

function writeJsonOrText(runtime, flags, payload, textLines) {
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return;
  }
  for (const line of textLines) runtime.writeOut(line);
}

async function postJson(runtime, path, body) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function getJson(runtime, path) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function deleteAt(runtime, path) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, { method: 'DELETE' });
  if (response.status === 204) return null;
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json().catch(() => null);
}

function requireFlag(flags, name, CliInputError) {
  const v = flags[name];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return v.trim();
}

async function runAddTerminalShortcut(flags, runtime, CliInputError) {
  const terminalIdentifier = requireFlag(flags, 'terminal', CliInputError);
  const label = requireFlag(flags, 'label', CliInputError);
  const command = requireFlag(flags, 'command', CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, terminalIdentifier, CliInputError);
  const payload = await postJson(runtime, '/api/shortcuts', {
    scope: 'terminal',
    scope_target: terminal.sessionId ?? terminal.id,
    label,
    command
  });
  writeJsonOrText(runtime, flags, payload, [
    `Added terminal shortcut ${payload.shortcut.id} (${label}) for ${terminal.name ?? terminal.sessionId}`
  ]);
  return 0;
}

async function runAddChatroomShortcut(flags, runtime, CliInputError) {
  const chatIdentifier = requireFlag(flags, 'chat', CliInputError);
  const label = requireFlag(flags, 'label', CliInputError);
  const command = requireFlag(flags, 'command', CliInputError);
  const room = await resolveChatRoomIdentifier(runtime, chatIdentifier, CliInputError);
  const payload = await postJson(runtime, '/api/shortcuts', {
    scope: 'chatroom',
    scope_target: room.id,
    label,
    command
  });
  writeJsonOrText(runtime, flags, payload, [
    `Added chatroom shortcut ${payload.shortcut.id} (${label}) for ${room.name}`
  ]);
  return 0;
}

async function runListShortcuts(flags, runtime, CliInputError) {
  const hasTerminalFlag = typeof flags.terminal === 'string' && flags.terminal.length > 0;
  const hasChatFlag = typeof flags.chat === 'string' && flags.chat.length > 0;
  if (hasTerminalFlag && hasChatFlag) {
    throw new CliInputError('listshortcuts accepts at most one of --terminal or --chat');
  }
  let scope = 'global';
  let target;
  let label;
  if (hasTerminalFlag) {
    const terminal = await resolveTerminalIdentifier(runtime, flags.terminal, CliInputError);
    scope = 'terminal';
    target = terminal.sessionId ?? terminal.id;
    label = `terminal ${terminal.name ?? terminal.sessionId}`;
  } else if (hasChatFlag) {
    const room = await resolveChatRoomIdentifier(runtime, flags.chat, CliInputError);
    scope = 'chatroom';
    target = room.id;
    label = `chatroom ${room.name}`;
  } else {
    label = 'global';
  }
  const query = new URLSearchParams({ scope });
  if (target) query.set('target', target);
  const payload = await getJson(runtime, `/api/shortcuts?${query.toString()}`);
  const rows = Array.isArray(payload.shortcuts) ? payload.shortcuts : [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  if (rows.length === 0) {
    runtime.writeOut(`No shortcuts for ${label}.`);
    return 0;
  }
  runtime.writeOut(`Shortcuts for ${label}:`);
  for (const row of rows) {
    runtime.writeOut(`  ${row.id}\t${row.label}\t${row.command}`);
  }
  return 0;
}

async function runRemoveShortcut(positionals, flags, runtime, CliInputError) {
  const id = positionals[0];
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CliInputError('removeshortcut needs a shortcut id positional');
  }
  await deleteAt(runtime, `/api/shortcuts/${encodeURIComponent(id.trim())}`);
  writeJsonOrText(runtime, flags, { removed: id.trim() }, [`Removed shortcut ${id.trim()}.`]);
  return 0;
}
