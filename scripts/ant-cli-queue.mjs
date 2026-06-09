/**
 * ant queue — thin CLI wrappers over the curated-queue API routes
 * (src/routes/api/chat-rooms/[roomId]/queue/…). The queue is a first-class,
 * durable, editable object; these verbs let the user (and scripts) inspect
 * and steer it from a terminal alongside the in-app UI and the curator.
 *
 *   ant queue list   --room ROOM [--handle @h] [--status pending] [--json]
 *   ant queue add    --room ROOM --handle @h --text "…" [--kind mention] [--priority N] [--source MSG_ID]
 *   ant queue edit   --room ROOM --id Q_ID [--text "…"] [--priority N] [--status …]
 *   ant queue reorder --room ROOM --id Q_ID --priority N
 *   ant queue drop   --room ROOM --id Q_ID
 *   ant queue pull   --room ROOM [--handle @h]
 *
 * Mirrors ant-cli-reaction.mjs: flag parsing, fetchImpl via runtime, and a
 * --json passthrough. Maps onto: GET/POST (collection), PATCH/DELETE
 * ([queueId]), POST (pull). Spec: docs/curated-queue-spec.md (CLI section).
 */

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleQueueVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'list': return runList(flags, runtime, CliInputError);
    case 'add': return runAdd(flags, runtime, CliInputError);
    case 'edit': return runEdit(flags, runtime, CliInputError);
    case 'reorder': return runReorder(flags, runtime, CliInputError);
    case 'drop': return runDrop(flags, runtime, CliInputError);
    case 'pull': return runPull(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    runtime.writeOut('ant queue <list|add|edit|reorder|drop|pull> --room ROOM [--handle @h] [flags]');
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown queue verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) throw new CliInputError(`missing required flag --${name}`);
  return value;
}

function queueCollectionPath(flags, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  return `/api/chat-rooms/${encodeURIComponent(room)}/queue`;
}

function queueItemPath(flags, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const id = requireFlag(flags, 'id', CliInputError);
  return `/api/chat-rooms/${encodeURIComponent(room)}/queue/${encodeURIComponent(id)}`;
}

function withHandleQuery(path, flags) {
  if (!flags.handle) return path;
  const url = new URL(path, 'http://ant.local');
  url.searchParams.set('handle', flags.handle);
  if (flags.status) url.searchParams.set('status', flags.status);
  return `${url.pathname}${url.search}`;
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

function writeJsonOrText(runtime, flags, payload, text) {
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(text);
}

async function runList(flags, runtime, CliInputError) {
  const path = withHandleQuery(queueCollectionPath(flags, CliInputError), flags);
  const payload = await fetchJson(runtime, path);
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const item of payload.items ?? []) {
    runtime.writeOut(`${item.id}\t[${item.status}]\tp${item.priority}\t${item.curatedText}`);
  }
  return 0;
}

async function runAdd(flags, runtime, CliInputError) {
  const body = {
    targetHandle: requireFlag(flags, 'handle', CliInputError),
    text: requireFlag(flags, 'text', CliInputError)
  };
  if (flags.kind) body.kind = flags.kind;
  if (flags.priority !== undefined) body.priority = Number(flags.priority);
  if (flags.source) body.sourceMessageId = flags.source;
  const payload = await fetchJson(runtime, queueCollectionPath(flags, CliInputError), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Queued ${payload.item?.id ?? ''}`.trim());
  return 0;
}

async function runEdit(flags, runtime, CliInputError) {
  const body = {};
  if (flags.text !== undefined) body.curatedText = flags.text;
  if (flags.priority !== undefined) body.priority = Number(flags.priority);
  if (flags.status !== undefined) body.status = flags.status;
  if (Object.keys(body).length === 0) {
    throw new CliInputError('queue edit needs at least one of --text, --priority, --status');
  }
  const payload = await fetchJson(runtime, queueItemPath(flags, CliInputError), {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Updated ${requireFlag(flags, 'id', CliInputError)}`);
  return 0;
}

async function runReorder(flags, runtime, CliInputError) {
  const body = { priority: Number(requireFlag(flags, 'priority', CliInputError)) };
  const payload = await fetchJson(runtime, queueItemPath(flags, CliInputError), {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Reordered ${requireFlag(flags, 'id', CliInputError)} → p${body.priority}`);
  return 0;
}

async function runDrop(flags, runtime, CliInputError) {
  const payload = await fetchJson(runtime, queueItemPath(flags, CliInputError), { method: 'DELETE' });
  writeJsonOrText(runtime, flags, payload, `Dropped ${requireFlag(flags, 'id', CliInputError)}`);
  return 0;
}

async function runPull(flags, runtime, CliInputError) {
  const body = {};
  if (flags.handle) body.targetHandle = flags.handle;
  const payload = await fetchJson(runtime, `${queueCollectionPath(flags, CliInputError)}/pull`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  if (payload.item) runtime.writeOut(`Pulled ${payload.item.id}: ${payload.item.curatedText}`);
  else runtime.writeOut('Nothing pulled (worker busy or queue empty)');
  return 0;
}
