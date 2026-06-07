/**
 * `ant sessions ...` — v3-shape verbs for session lifecycle.
 *
 * JWPK 2026-05-16: the `sessions create` verb is the v3 wording JWPK wants
 * preserved as an alias of `ant new terminal` so existing muscle-memory + v3
 * docs keep working without forcing a global rename. `sessions export` dumps
 * a chat room (= the terminal chat that backs a terminal session) as JSONL so
 * the room transcript can be archived, replayed, or shipped to another ANT.
 *
 *   ant sessions create <name> [--agent-kind K] [--cwd P] [--handle @x] [--json]
 *     → delegates to POST /api/terminals via makeStandardSendJson — same
 *       semantics as `ant new terminal`. Reuses the shared shape so server
 *       behaviour (auto-register, terminal chat, tmux pane) stays canonical.
 *
 *   ant sessions export <session-or-room-id> [--format markdown|json|text] [--out FILE] [--json]
 *     → GETs /api/sessions/<id>/export so full-history export remains
 *       server-side and is not capped by chat lazy-loading pagination.
 */

import { writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { makeStandardSendJson } from './ant-cli-shared-resolve.mjs';

const BOOLEAN_FLAGS = new Set(['json', 'all', 'resume', 'no-agents', 'dry-run']);
const KNOWN_AGENT_KINDS = new Set(['claude', 'codex', 'pi', 'gemini', 'qwen', 'copilot']);

export async function handleSessionsVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  // `recover` takes any number of leading positional names, so it parses its
  // own args rather than consuming a single leading positional below.
  if (action === 'recover') {
    return runSessionsRecover(args, runtime, CliInputError);
  }
  let positional;
  if (args.length > 0 && !args[0].startsWith('--')) {
    positional = args[0];
    args = args.slice(1);
  }
  const flags = parseFlags(args, CliInputError);

  switch (action) {
    case 'create':
      if (positional && !flags.name) flags.name = positional;
      return runSessionsCreate(flags, runtime, CliInputError);
    case 'export':
      if (positional && !flags.room) flags.room = positional;
      return runSessionsExport(flags, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action ? 0 : 1;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown sessions verb: ${action}`);
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
  runtime.writeOut('ant sessions <create|export|recover> [name|flags]');
  runtime.writeOut('  sessions create <name> [--agent-kind KIND] [--cwd PATH] [--handle @x] [--json]');
  runtime.writeOut('     → alias of `ant new terminal`. POSTs /api/terminals.');
  runtime.writeOut('  sessions export <session-or-room-id> [--format markdown|json|text] [--out FILE] [--json]');
  runtime.writeOut('     → downloads full server-side export (default markdown).');
  runtime.writeOut('  sessions recover [names…] [--all] [--resume] [--no-agents] [--dry-run] [--json]');
  runtime.writeOut('     → rebuild dead sessions after a reboot: recreate the tmux pane in the');
  runtime.writeOut('       original cwd, re-run the agent launch command, and rebind identity.');
  runtime.writeOut('       --all recovers every not-alive session; --resume appends --resume "<name>";');
  runtime.writeOut('       --no-agents recreates panes only; --dry-run prints the commands.');
  runtime.writeOut('');
  runtime.writeOut('  KIND ∈ { claude, codex, pi, gemini, qwen, copilot }');
}

async function runSessionsCreate(flags, runtime, CliInputError) {
  if (!flags.name) {
    throw new CliInputError('sessions create: --name is required (or pass as first positional)');
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
    runtime.writeOut(`Spawned session ${result.sessionId} ("${result.name}", agentKind=${result.agentKind ?? '(unset)'}).`);
    runtime.writeOut(`  Terminal chat: ${result.linkedChatRoomId}`);
    runtime.writeOut(`  Tmux pane:    ${result.tmuxTargetPane}`);
    runtime.writeOut(`  Derived handle: ${result.derivedHandle}`);
    runtime.writeOut(`Attach with:    tmux attach-session -t ${result.sessionId}`);
  }
  return 0;
}

async function runSessionsExport(flags, runtime, CliInputError) {
  if (!flags.room) {
    throw new CliInputError('sessions export: session or room id is required (positional or --room)');
  }
  const format = flags.format ?? (flags.json !== undefined ? 'json' : 'markdown');
  if (!['markdown', 'json', 'text'].includes(format)) {
    throw new CliInputError('--format must be one of: markdown, json, text');
  }

  const exportResponse = await runtime.fetchImpl(
    `${runtime.serverUrl}/api/sessions/${encodeURIComponent(flags.room)}/export?format=${encodeURIComponent(format)}`
  );
  if (!exportResponse.ok) {
    const text = await exportResponse.text().catch(() => '');
    throw new Error(`could not export session ${flags.room}: ${exportResponse.status} ${text}`.trim());
  }
  const body = await exportResponse.text();

  if (flags.out) {
    const target = resolvePath(process.cwd(), flags.out);
    await writeFile(target, body, 'utf8');
    if (flags.json !== undefined) {
      runtime.writeOut(JSON.stringify({ sessionId: flags.room, format, out: target }));
    } else {
      runtime.writeOut(`Exported session ${flags.room} (${format}) to ${target}.`);
    }
  } else {
    for (const line of body.trimEnd().split('\n')) runtime.writeOut(line);
  }
  return 0;
}

/**
 * Parse recover args: any number of leading positional names + boolean flags.
 * Unlike parseFlags, positionals are collected (the session names) rather than
 * rejected.
 */
function parseRecoverArgs(rawArgs, CliInputError) {
  const flags = {};
  const names = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      names.push(token);
      cursor += 1;
      continue;
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
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
  return { flags, names };
}

/** Resolve a user-supplied identifier to a terminal from the GET list. */
function matchTerminal(terminals, identifier) {
  const wanted = identifier.startsWith('@') ? identifier : null;
  return terminals.find((t) =>
    t.sessionId === identifier ||
    t.name === identifier ||
    t.handle === identifier ||
    t.derivedHandle === identifier ||
    (wanted && (t.handle === wanted || t.derivedHandle === wanted))
  ) ?? null;
}

async function runSessionsRecover(args, runtime, CliInputError) {
  const { flags, names } = parseRecoverArgs(args, CliInputError);
  if (!flags.all && names.length === 0) {
    throw new CliInputError('sessions recover: pass session names, or --all to recover every dead session.');
  }

  const sendJson = makeStandardSendJson(runtime);
  const listing = await sendJson('/api/terminals', 'GET');
  const terminals = Array.isArray(listing?.terminals) ? listing.terminals : [];

  let targets;
  if (flags.all) {
    targets = terminals.filter((t) => t.alive === false);
    if (targets.length === 0) {
      runtime.writeOut('No dead sessions to recover — every terminal is already alive.');
      return 0;
    }
  } else {
    targets = [];
    for (const name of names) {
      const match = matchTerminal(terminals, name);
      if (!match) throw new CliInputError(`no terminal matches "${name}" (try a name, @handle, or sessionId)`);
      targets.push(match);
    }
  }

  const sessionIds = targets.map((t) => t.sessionId);
  const body = {
    sessionIds,
    resume: flags.resume === true,
    launchAgents: flags['no-agents'] !== true,
    dryRun: flags['dry-run'] === true
  };
  const result = await sendJson('/api/terminals/recover', 'POST', body);
  const outcomes = Array.isArray(result?.recovered) ? result.recovered : [];

  if (flags.json !== undefined && flags.json !== false) {
    runtime.writeOut(JSON.stringify(result));
    return 0;
  }

  if (body.dryRun) {
    runtime.writeOut(`Recovery plan for ${outcomes.length} session(s):`);
  } else {
    runtime.writeOut(`Recovered ${outcomes.length} session(s):`);
  }
  for (const o of outcomes) {
    const cmd = o.command ? o.command : '(shell only — no agent command)';
    const status = o.error ? `ERROR: ${o.error}` : `${o.action}${o.agentLaunched ? ' + agent' : ''}`;
    runtime.writeOut(`  ${o.name}  [${status}]`);
    runtime.writeOut(`    → ${cmd}`);
  }
  return 0;
}
