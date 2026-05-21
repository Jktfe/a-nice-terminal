#!/usr/bin/env node
/**
 * Live M3.6a-v1 cutover probe.
 *
 * The server owns the strict/warning decision via
 * ANT_AUTH_DEPRECATION_CUTOVER_MS. This script does not flip that flag; it
 * creates a disposable room and checks the observable route behaviour.
 */

const DEFAULT_SERVER_URL = process.env.ANT_SERVER_URL ?? 'http://127.0.0.1:6174';
const HEADER = 'x-auth-deprecation';
const EXPECTED = new Set(['auto', 'warning', 'strict']);

class InputError extends Error {}

function parseArgs(argv) {
  const opts = { serverUrl: DEFAULT_SERVER_URL, expect: 'auto', json: false };
  for (let cursor = 0; cursor < argv.length;) {
    const token = argv[cursor];
    if (token === '--json') { opts.json = true; cursor += 1; continue; }
    if (token === '--server') {
      opts.serverUrl = requireValue(argv, cursor, '--server');
      cursor += 2; continue;
    }
    if (token === '--expect') {
      opts.expect = requireValue(argv, cursor, '--expect');
      if (!EXPECTED.has(opts.expect)) throw new InputError('--expect must be auto, warning, or strict');
      cursor += 2; continue;
    }
    if (token === '--help' || token === 'help') {
      opts.help = true; cursor += 1; continue;
    }
    throw new InputError(`unknown argument: ${token}`);
  }
  return opts;
}

function requireValue(argv, cursor, flag) {
  const value = argv[cursor + 1];
  if (!value || value.startsWith('--')) throw new InputError(`${flag} needs a value`);
  return value;
}

function stableUrl(base, path) {
  return `${base.replace(/\/$/, '')}${path}`;
}

async function postJson(fetchImpl, serverUrl, path, body, headers = {}) {
  return fetchImpl(stableUrl(serverUrl, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function deleteJson(fetchImpl, serverUrl, path, body) {
  return fetchImpl(stableUrl(serverUrl, path), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
}

async function jsonOrText(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function expectOkJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(await jsonOrText(response))}`);
  }
  return response.json();
}

function classifyDeprecatedWrite(label, response, successStatuses) {
  const header = response.headers.get(HEADER);
  if (response.status === 403) return { label, mode: 'strict', status: response.status, header };
  if (successStatuses.includes(response.status) && header?.startsWith('warning;')) {
    return { label, mode: 'warning', status: response.status, header };
  }
  return { label, mode: 'unexpected', status: response.status, header };
}

function assertExpectedMode(summary, expected) {
  const modes = new Set(summary.deprecatedWrites.map((probe) => probe.mode));
  if (modes.has('unexpected')) {
    throw new Error(`unexpected probe response: ${JSON.stringify(summary.deprecatedWrites)}`);
  }
  if (modes.size !== 1) {
    throw new Error(`inconsistent deprecation modes: ${Array.from(modes).join(',')}`);
  }
  const mode = Array.from(modes)[0];
  summary.mode = mode;
  if (expected !== 'auto' && expected !== mode) {
    throw new Error(`expected ${expected} mode but observed ${mode}`);
  }
}

async function createProbeRoom(fetchImpl, serverUrl) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const handle = '@cutover-probe';

  const roomPayload = await expectOkJson(await postJson(fetchImpl, serverUrl, '/api/chat-rooms', {
    name: `auth-cutover-probe-${suffix}`,
    whoCreatedIt: handle
  }), 'create room');
  const roomId = roomPayload.chatRoom?.id;
  if (!roomId) throw new Error('create room response did not include chatRoom.id');
  return { roomId };
}

export async function runAuthCutoverCheck({
  argv = [],
  fetchImpl = globalThis.fetch.bind(globalThis),
  writeOut = (line) => console.log(line),
  writeErr = (line) => console.error(line)
} = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    writeOut('usage: node scripts/check-auth-cutover.mjs [--server URL] [--expect auto|warning|strict] [--json]');
    return 0;
  }

  void writeErr;
  const { roomId } = await createProbeRoom(fetchImpl, opts.serverUrl);
  const deprecatedWrites = [];

  const messageNoIdentity = await postJson(fetchImpl, opts.serverUrl, `/api/chat-rooms/${encodeURIComponent(roomId)}/messages`, {
    authorHandle: '@legacy-probe',
    body: 'auth cutover no identity probe'
  });
  const messageProbe = classifyDeprecatedWrite('messages-post', messageNoIdentity, [201]);
  deprecatedWrites.push(messageProbe);
  let parentMessageId = null;
  if (messageProbe.mode === 'warning') {
    const body = await messageNoIdentity.json().catch(() => null);
    parentMessageId = body?.message?.id ?? null;
  }

  const memberHandle = `@cutover-agent-${Math.random().toString(36).slice(2, 7)}`;
  const memberPost = await postJson(fetchImpl, opts.serverUrl, `/api/chat-rooms/${encodeURIComponent(roomId)}/members`, {
    agentHandle: memberHandle
  });
  deprecatedWrites.push(classifyDeprecatedWrite('members-post', memberPost, [201]));

  const memberDelete = await deleteJson(
    fetchImpl,
    opts.serverUrl,
    `/api/chat-rooms/${encodeURIComponent(roomId)}/members?globalHandle=${encodeURIComponent(memberHandle)}`
  );
  deprecatedWrites.push(classifyDeprecatedWrite('members-delete', memberDelete, [204]));

  let discussionsStrictOnly;
  if (parentMessageId) {
    const discussionNoIdentity = await postJson(fetchImpl, opts.serverUrl, `/api/chat-rooms/${encodeURIComponent(roomId)}/discussions`, {
      parentMessageId,
      title: 'auth cutover strict-only probe'
    });
    discussionsStrictOnly = {
      label: 'discussions-post',
      status: discussionNoIdentity.status,
      ok: discussionNoIdentity.status === 403
    };
  } else {
    discussionsStrictOnly = {
      label: 'discussions-post',
      status: null,
      ok: true,
      skipped: 'no parent message created once deprecated writes are strict'
    };
  }

  const summary = {
    serverUrl: opts.serverUrl,
    roomId,
    mode: 'unknown',
    deprecatedWrites,
    discussionsStrictOnly
  };
  assertExpectedMode(summary, opts.expect);
  if (!discussionsStrictOnly.ok) {
    throw new Error(`discussions-post expected strict-only 403, got ${discussionNoIdentity.status}`);
  }

  if (opts.json) writeOut(JSON.stringify(summary));
  else {
    writeOut(`auth cutover mode: ${summary.mode}`);
    for (const probe of deprecatedWrites) writeOut(`${probe.label}\t${probe.status}\t${probe.mode}`);
    const discussionStatus = discussionsStrictOnly.skipped ? 'skipped' : discussionsStrictOnly.status;
    writeOut(`discussions-post\t${discussionStatus}\tstrict-only`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAuthCutoverCheck({ argv: process.argv.slice(2) }).catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  });
}
