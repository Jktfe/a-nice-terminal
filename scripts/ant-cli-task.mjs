/**
 * `ant task ...` — JWPK TASKS-SUBSYSTEM CLI (2026-05-16).
 *
 *   ant task list   [--terminal NAME | --status S | --assigned @h] [--room NAME] [--json]
 *   ant task create --title TEXT [--terminal NAME | --assigned @h] [--room NAME]
 *                   [--plan PLAN_ID]
 *                   [--description TEXT] [--json]
 *   ant task done   <taskId> [--json]
 *   ant task assign <taskId> --to @h [--json]
 *
 * Resolvers: `--terminal NAME` → terminal sessionId via the shared
 * resolveTerminalIdentifier; `--room NAME` → roomId via resolveChatRoom-
 * Identifier. JSON in / JSON out for scripted callers.
 *
 * 9-year-old-readable. No client-side caching — every verb is one fetch.
 */

import {
  resolveTerminalIdentifier,
  resolveChatRoomIdentifier,
  makeStandardSendJson
} from './ant-cli-shared-resolve.mjs';
import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleTaskVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  switch (action) {
    case 'list': return runList(args, runtime, CliInputError);
    case 'create': return runCreate(args, runtime, CliInputError);
    case 'done': return runDone(args, runtime, CliInputError);
    case 'assign': return runAssign(args, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action ? 0 : 1;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown task verb: ${action}`);
  }
}

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
  runtime.writeOut('ant task <list|create|done|assign>');
  runtime.writeOut('');
  runtime.writeOut('  list [--terminal NAME] [--status S] [--assigned @h] [--room NAME] [--json]');
  runtime.writeOut('  create --title TEXT [--description TEXT] [--terminal NAME]');
  runtime.writeOut('         [--assigned @h] [--room NAME] [--plan PLAN_ID] [--json]');
  runtime.writeOut('  done <taskId> [--json]');
  runtime.writeOut('  assign <taskId> --to @h [--json]');
  runtime.writeOut('');
  runtime.writeOut('  status values: todo | in_progress | done | cancelled | blocked');
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const params = new URLSearchParams();
  if (flags.terminal !== undefined) {
    const terminal = await resolveTerminalIdentifier(runtime, flags.terminal, CliInputError);
    params.set('terminal', terminal.sessionId);
  }
  if (flags.room !== undefined) {
    const room = await resolveChatRoomIdentifier(runtime, flags.room, CliInputError);
    params.set('room', room.id);
    params.set('pidChain', JSON.stringify(processIdentityChain()));
  }
  if (flags.status !== undefined) params.set('status', flags.status);
  if (flags.assigned !== undefined) params.set('assigned', flags.assigned);

  // Filter mode requires at least one JWPK query param. Default (no
  // filters) still uses the JWPK route by passing status=todo as a
  // default-ish nudge would be wrong; instead force JWPK mode by
  // requesting status=todo only when no filter given. Simpler: always
  // pass `status=` empty? Empty values are dropped by URLSearchParams,
  // so we need a real flag — use a marker `assigned=` with empty value.
  // Cleanest: if no filter, list every JWPK task by passing status=todo
  // is wrong (drops done). Pass a sentinel `room=` with empty? Server
  // treats empty as "match empty roomId", which is wrong too. So if no
  // filter, just fetch /api/tasks and trust legacy/JWPK union via the
  // JWPK route forced via `status` query token presence — set
  // status=todo,in_progress,done style isn't supported. Solution: send
  // `assigned=` only when actually set; otherwise just fetch /api/tasks
  // and rely on the route's empty-JWPK-query branch which falls back to
  // the Lane-D shape. That's fine for `task list` with no filters — it
  // returns the union via the Lane-D rows. To force JWPK shape with no
  // filter we pass a benign `status` param when needed for JSON output.
  const path = params.toString().length > 0
    ? `/api/tasks?${params.toString()}`
    : `/api/tasks`;

  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`);
  if (!response.ok) throw new Error(`could not list tasks: ${response.status}`);
  const payload = await response.json();
  const tasks = payload.tasks ?? [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  if (tasks.length === 0) {
    runtime.writeOut('No tasks.');
    return 0;
  }
  for (const t of tasks) {
    // Defensive print: both shapes (JWPK title vs Lane-D subject) may
    // appear depending on which branch the route picked. Show whichever
    // field is populated.
    const title = t.title ?? t.subject ?? '(untitled)';
    const status = t.status ?? '?';
    const who = t.assignedTo ?? t.assignedAgent ?? '-';
    runtime.writeOut(`${t.id}\t${status}\t${who}\t${title}`);
  }
  return 0;
}

async function runCreate(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  if (!flags.title || flags.title.trim().length === 0) {
    throw new CliInputError('task create needs --title TEXT');
  }
  const body = {
    title: flags.title,
    description: flags.description ?? ''
  };
  if (flags.terminal !== undefined) {
    const terminal = await resolveTerminalIdentifier(runtime, flags.terminal, CliInputError);
    body.assigned_terminal_id = terminal.sessionId;
  }
  if (flags.assigned !== undefined) {
    body.assigned_to = flags.assigned;
  }
  if (flags.room !== undefined) {
    const room = await resolveChatRoomIdentifier(runtime, flags.room, CliInputError);
    body.room_id = room.id;
    body.pidChain = processIdentityChain();
  }
  if (flags.plan !== undefined) {
    body.plan_id = flags.plan;
  }
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson('/api/tasks', 'POST', body);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const t = result.task ?? {};
    runtime.writeOut(`Created task ${t.id}: ${t.title ?? '(untitled)'}`);
  }
  return 0;
}

async function runDone(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const taskId = positionals[0];
  if (!taskId) throw new CliInputError('task done needs a taskId (positional)');
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    'PATCH',
    { status: 'done' }
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const t = result.task ?? {};
    runtime.writeOut(`Marked ${t.id ?? taskId} done.`);
  }
  return 0;
}

async function runAssign(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const taskId = positionals[0];
  if (!taskId) throw new CliInputError('task assign needs a taskId (positional)');
  if (!flags.to || flags.to.trim().length === 0) {
    throw new CliInputError('task assign needs --to @handle');
  }
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    'PATCH',
    { assigned_to: flags.to }
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const t = result.task ?? {};
    runtime.writeOut(`Assigned ${t.id ?? taskId} → ${t.assignedTo ?? flags.to}`);
  }
  return 0;
}
