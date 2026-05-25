/**
 * ant chat pending — surface messages addressed to me that I haven't
 * threaded a reply to. Wraps GET /api/chat-rooms/messages/pending.
 *
 * Usage:
 *   ant chat pending --handle @me [--since <epochMs>] [--json]
 *
 * Output: one line per pending message in oldest-first global post_order:
 *   <postedAt>  <roomId>  <authorHandle>: <body-truncated>
 *
 * --json passes the server payload through unchanged.
 *
 * Returns code 0 on success (including the empty case — prints a friendly
 * "(nothing pending …)" hint to stdout). CliInputError is thrown for
 * missing --handle.
 *
 * Shipped as a separate file so the shared `ant-cli-chat.mjs` doesn't
 * need a structural edit during this work; the parent integrator imports
 * `handleChatPendingVerb` and calls it from the `chat` action switch.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);
const BODY_TRUNCATE_LIMIT = 280;

export async function handleChatPendingVerb(args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);

  if (flags.help !== undefined) {
    writeUsage(runtime);
    return 0;
  }

  const handle = requireFlag(flags, 'handle', CliInputError);
  const query = new URLSearchParams({ handle });
  if (flags.since !== undefined) {
    const parsed = Number(flags.since);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new CliInputError('--since must be a non-negative epoch-ms integer');
    }
    query.set('since', String(parsed));
  }
  query.set('pidChain', JSON.stringify(processIdentityChain()));

  const path = `/api/chat-rooms/messages/pending?${query.toString()}`;
  const payload = await fetchJson(runtime, path);

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }

  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (messages.length === 0) {
    runtime.writeOut(`(nothing pending for ${handle})`);
    return 0;
  }
  for (const m of messages) {
    const body = truncateBody(m.body ?? '');
    runtime.writeOut(`${m.postedAt}\t${m.roomId}\t${m.authorHandle}: ${body}`);
  }
  return 0;
}

function writeUsage(runtime) {
  runtime.writeOut('ant chat pending --handle @h [--since <epochMs>] [--json]');
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name) || name === 'help') {
      flags[name] = 'true'; cursor += 1; continue;
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

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

async function fetchJson(runtime, path) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

function truncateBody(rawBody) {
  const flat = String(rawBody).replace(/\s+/g, ' ').trim();
  if (flat.length <= BODY_TRUNCATE_LIMIT) return flat;
  return `${flat.slice(0, BODY_TRUNCATE_LIMIT - 1)}…`;
}
