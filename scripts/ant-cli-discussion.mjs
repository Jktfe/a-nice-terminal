/**
 * ant discussion — CLI verbs for the M3.4b discussions endpoint.
 *
 * Verbs:
 *   ant discussion create --room ROOM_ID --from MESSAGE_ID [--title "..."] [--json]
 *   ant discussion close --id DISCUSSION_ID --summary "..." [--json]
 *      (PATCHes /api/discussions/{id}; first call transitions open→closed;
 *       subsequent call updates summary in place per Q4-4b)
 *   ant discussion list --room ROOM_ID [--status open|closed|all] [--json]
 *   ant discussion show --id DISCUSSION_ID [--json]
 *
 * Writes go through IDENTITY-GATE via processIdentityChain (matches existing
 * room mode/responders/invite CLI patterns).
 */
import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);
const ALLOWED_STATUS = ['open', 'closed', 'all'];

export async function handleDiscussionVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'create': return runCreate(flags, runtime, CliInputError);
    case 'close': return runClose(flags, runtime, CliInputError);
    case 'list': return runList(flags, runtime, CliInputError);
    case 'show': return runShow(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown discussion verb: ${action}`);
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

function writeUsage(runtime) {
  runtime.writeOut('ant discussion <create|close|list|show> [flags]');
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
  if (response.status === 204) return {};
  return response.json();
}

function writeJsonOrText(runtime, flags, payload, text) {
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(text);
}

async function runCreate(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const parentMessageId = requireFlag(flags, 'from', CliInputError);
  const body = { parentMessageId, pidChain: processIdentityChain() };
  if (flags.title) body.title = flags.title;
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/discussions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Discussion ${payload.discussion.id} (parent ${payload.discussion.parent_message_id}, opened by ${payload.discussion.opened_by})`);
  return 0;
}

async function runClose(flags, runtime, CliInputError) {
  const id = requireFlag(flags, 'id', CliInputError);
  const summary = requireFlag(flags, 'summary', CliInputError);
  const body = { summary, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/discussions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Discussion ${payload.discussion.id} closed (summary: ${payload.discussion.summary})`);
  return 0;
}

async function runList(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const status = flags.status ?? 'open';
  if (!ALLOWED_STATUS.includes(status)) throw new CliInputError(`--status must be one of: ${ALLOWED_STATUS.join(', ')}`);
  // Room-scoped GET — append pidChain for the hooks.server.ts gate.
  // Same pattern as ant-cli-chat-pending (24fba92) and PR #61 rooms members.
  const query = new URLSearchParams({
    status,
    pidChain: JSON.stringify(processIdentityChain())
  });
  const path = `/api/chat-rooms/${encodeURIComponent(room)}/discussions?${query.toString()}`;
  const payload = await fetchJson(runtime, path);
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const d of payload.discussions ?? []) {
    runtime.writeOut(`${d.id}\t${d.status}\t${d.opened_by}\t${d.title ?? '(no title)'}`);
  }
  return 0;
}

async function runShow(flags, runtime, CliInputError) {
  const id = requireFlag(flags, 'id', CliInputError);
  const payload = await fetchJson(runtime, `/api/discussions/${encodeURIComponent(id)}`);
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  const d = payload.discussion;
  runtime.writeOut(`${d.id} (${d.status}) opened by ${d.opened_by}${d.summary ? ` — summary: ${d.summary}` : ''}`);
  for (const m of payload.messages ?? []) {
    runtime.writeOut(`  ${m.postOrder}\t${m.authorHandle}\t${m.body}`);
  }
  return 0;
}
