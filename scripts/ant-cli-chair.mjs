import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleChairVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'enable': return runEnable(flags, runtime);
    case 'disable': return runDisable(flags, runtime);
    case 'handoff': return runHandoff(flags, runtime, CliInputError);
    case 'board': return runBoard(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown chair verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
      // Positional args (e.g. <room-id>) — first bare token becomes flags.room
      if (flags.room === undefined) { flags.room = token; cursor += 1; continue; }
      throw new CliInputError(`unexpected positional arg: ${token}`);
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function writeUsage(runtime) {
  runtime.writeOut('ant chair <enable|disable|handoff|board> [room-id] [flags]');
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

async function runEnable(flags, runtime) {
  const body = { enabled: true, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chair-enabled`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, 'Chair enabled.');
  return 0;
}

async function runDisable(flags, runtime) {
  const body = { enabled: false, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chair-enabled`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, 'Chair disabled.');
  return 0;
}

async function runHandoff(flags, runtime, CliInputError) {
  const room = flags.room;
  if (!room) throw new CliInputError('missing room-id positional arg');
  const to = flags.to;
  if (!to) throw new CliInputError('missing required flag --to');
  const body = { toHandle: to, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/chair/handoff`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Chair in ${room} handed to ${to}.`);
  return 0;
}

async function runBoard(flags, runtime, CliInputError) {
  const room = flags.room;
  if (!room) throw new CliInputError('missing room-id positional arg');
  const payload = await fetchJson(runtime, `/api/chair`);
  const digest = (payload.chairDigest ?? []).find((row) => row.roomId === room || row.room_id === room);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(digest ?? null));
    return 0;
  }
  if (!digest) {
    runtime.writeOut(`No chair digest for room ${room}.`);
    return 0;
  }
  runtime.writeOut(`Chair board for ${room}:`);
  for (const [k, v] of Object.entries(digest)) {
    if (k === 'roomId' || k === 'room_id') continue;
    runtime.writeOut(`  ${k}: ${JSON.stringify(v)}`);
  }
  return 0;
}
