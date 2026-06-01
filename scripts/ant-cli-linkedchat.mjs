/**
 * ant linkedchat — CLI verbs for terminal-scoped linked-chat permissions.
 *
 *   ant linkedchat list <terminal-id> [--json]
 *   ant linkedchat allow <terminal-id> --handle @x [--reason "..."] [--json]
 *   ant linkedchat deny <terminal-id> --handle @x [--reason "..."] [--json]
 *
 * All verbs send pidChain. List is read-only but still gated so permission
 * rows cannot be enumerated by terminal id alone.
 */
import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleLinkedchatVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const { flags, pos } = parseFlags(args, CliInputError);
  switch (action) {
    case 'list': return runList(pos, flags, runtime, CliInputError);
    case 'allow': return runSet('allow', pos, flags, runtime, CliInputError);
    case 'deny': return runSet('deny', pos, flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown linkedchat verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {}, pos = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) { pos.push(token); cursor += 1; continue; }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return { flags, pos };
}

function writeUsage(runtime) {
  runtime.writeOut('ant linkedchat <list|allow|deny> <terminal-id> [flags]');
}

function requireTerminal(pos, CliInputError) {
  const terminalId = pos[0];
  if (!terminalId) throw new CliInputError('linkedchat verb needs a terminal-id');
  return terminalId;
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) throw new CliInputError(`missing required flag --${name}`);
  return value;
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

function relativeTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (deltaSeconds < 60) return 'just now';
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

async function runList(pos, flags, runtime, CliInputError) {
  const terminalId = requireTerminal(pos, CliInputError);
  const chain = encodeURIComponent(JSON.stringify(processIdentityChain()));
  const payload = await fetchJson(runtime, `/api/terminals/${encodeURIComponent(terminalId)}/linkedchat?pidChain=${chain}`);
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const row of payload.permissions ?? []) {
    runtime.writeOut(`${row.subject_handle}\t${row.state}\t${row.set_by}\t${relativeTime(row.set_at_ms)}`);
  }
  return 0;
}

async function runSet(state, pos, flags, runtime, CliInputError) {
  const terminalId = requireTerminal(pos, CliInputError);
  const handle = requireFlag(flags, 'handle', CliInputError);
  const body = { subjectHandle: handle, state, pidChain: processIdentityChain() };
  if (flags.reason !== undefined) body.reason = flags.reason;
  const payload = await fetchJson(runtime, `/api/terminals/${encodeURIComponent(terminalId)}/linkedchat`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Terminal chat ${state} for ${handle} on ${terminalId}`);
  return 0;
}
