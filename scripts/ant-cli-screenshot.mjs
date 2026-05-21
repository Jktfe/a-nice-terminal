import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);
const ALLOWED_FLAGS = new Set(['json', 'sha', 'file', 'topic', 'taken-by']);

export async function handleScreenshotVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'enable': return runEnable(flags, runtime, CliInputError);
    case 'disable': return runDisable(flags, runtime, CliInputError);
    case 'list': return runList(flags, runtime, CliInputError);
    case 'prune': return runPrune(flags, runtime, CliInputError);
    case 'take': return runTake(flags, runtime, ctx);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown screenshot verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
      if (flags.room === undefined) { flags.room = token; cursor += 1; continue; }
      throw new CliInputError(`unexpected positional arg: ${token}`);
    }
    const name = token.slice(2);
    if (!ALLOWED_FLAGS.has(name)) throw new CliInputError(`unknown flag --${name}`);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function writeUsage(runtime) {
  runtime.writeOut('ant screenshot <enable|disable|list|prune|take> --room ROOM_ID [flags]');
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  if (response.status === 204) return {};
  return response.json();
}

function writeJsonOrText(runtime, flags, payload, text) {
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(text);
}

function requireRoom(flags, CliInputError) {
  if (!flags.room) throw new CliInputError('missing required flag --room (or positional room-id)');
  return flags.room;
}

async function runEnable(flags, runtime, CliInputError) {
  const room = requireRoom(flags, CliInputError);
  const body = { enabled: true, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/screenshots/enable`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Shared screenshot folder enabled for ${room}.`);
  return 0;
}

async function runDisable(flags, runtime, CliInputError) {
  const room = requireRoom(flags, CliInputError);
  const body = { enabled: false, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/screenshots/enable`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Shared screenshot folder disabled for ${room}.`);
  return 0;
}

async function runTake(flags, runtime, ctx) {
  const { CliInputError } = ctx;
  const room = requireRoom(flags, CliInputError);
  if (!flags.file) throw new CliInputError('missing required flag --file PATH');
  const fs = ctx.fs ?? (await import('node:fs/promises'));
  const bytes = await fs.readFile(flags.file);
  const takenBy = flags['taken-by'] ?? '@cli';
  const body = {
    bytes: bytes.toString('base64'),
    takenBy,
    pidChain: processIdentityChain()
  };
  if (flags.topic) body.topic = flags.topic;
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/screenshots`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload,
    payload.kind === 'inserted'
      ? `Captured ${payload.sha.slice(0, 12)}… → ${payload.canonicalPath}`
      : `Already-seen ${payload.sha.slice(0, 12)}… in ${room} (canonical: ${payload.canonicalPath})`);
  return 0;
}

async function runPrune(flags, runtime, CliInputError) {
  const room = requireRoom(flags, CliInputError);
  if (!flags.sha) throw new CliInputError('missing required flag --sha SHA');
  const body = { pidChain: processIdentityChain() };
  const path = `/api/chat-rooms/${encodeURIComponent(room)}/screenshots/${encodeURIComponent(flags.sha)}/prune`;
  const payload = await fetchJson(runtime, path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload,
    payload.changed
      ? `Soft-deleted ${flags.sha.slice(0, 12)}… in ${room}.`
      : `Already pruned: ${flags.sha.slice(0, 12)}… in ${room}.`);
  return 0;
}

async function runList(flags, runtime, CliInputError) {
  const room = requireRoom(flags, CliInputError);
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/screenshots`);
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  const rows = payload.screenshots ?? [];
  if (rows.length === 0) { runtime.writeOut(`No screenshots in ${room}.`); return 0; }
  runtime.writeOut(`${rows.length} screenshot(s) in ${room}:`);
  for (const r of rows) {
    const ts = new Date(r.taken_at_ms).toISOString();
    runtime.writeOut(`  ${r.sha.slice(0, 12)}…  ${ts}  by ${r.taken_by}  (${r.bytes} bytes)`);
  }
  return 0;
}
