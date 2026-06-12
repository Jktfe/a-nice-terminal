import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import {
  withDurableSessionIdentity,
  durableSessionHeaders,
  attachmentHeaders
} from './ant-cli-chat.mjs';

const BOOLEAN_FLAGS = new Set(['json']);
const HEARD_READ_EMOJI = '🧏‍♂️';

// Identity attachment for reaction mutations (JWPK 2026-06-12). Reactions used
// to 401 because the CLI sent NO identity at all. The mutation gate's clean
// path resolves the WITNESSED BINDING from the durable session (x-ant-session-id
// header + sessionId in the body) — the ANThandle, NOT pidChain. pidChain rides
// along only to corroborate the session→terminal binding; it is never the
// identity. attachmentHeaders lets a paneless agent react via its lease. This
// mirrors `ant chat send` exactly so reactions authenticate the same way posts do.
function identifiedReaction(runtime, flags, room, body) {
  return {
    body: withDurableSessionIdentity(runtime, room, { ...body, pidChain: processIdentityChain() }),
    headers: {
      'content-type': 'application/json',
      ...attachmentHeaders(flags),
      ...durableSessionHeaders(runtime, room)
    }
  };
}

export async function handleReactionVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'list': return runList(flags, runtime, CliInputError);
    case 'add': return runAdd(flags, runtime, CliInputError);
    case 'remove': return runRemove(flags, runtime, CliInputError);
    case 'heard': return runHeard(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    runtime.writeOut('ant reaction <list|add|remove|heard> [flags]');
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown reaction verb: ${action}`);
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

function reactionPath(flags, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const message = requireFlag(flags, 'message', CliInputError);
  return `/api/chat-rooms/${encodeURIComponent(room)}/messages/${encodeURIComponent(message)}/reactions`;
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
  // GET reactions is read-gated too — attach the durable session identity (and
  // an attachment lease for paneless callers) so listing resolves the caller's
  // membership the same way the post path does. No body on a GET, so just headers.
  const room = requireFlag(flags, 'room', CliInputError);
  const payload = await fetchJson(runtime, reactionPath(flags, CliInputError), {
    headers: { ...attachmentHeaders(flags), ...durableSessionHeaders(runtime, room) }
  });
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const reaction of payload.reactions ?? []) {
    runtime.writeOut(`${reaction.reactorHandle}\t${reaction.emoji}`);
  }
  return 0;
}

async function runAdd(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const { body, headers } = identifiedReaction(runtime, flags, room, {
    reactorHandle: requireFlag(flags, 'handle', CliInputError),
    emoji: requireFlag(flags, 'emoji', CliInputError)
  });
  const payload = await fetchJson(runtime, reactionPath(flags, CliInputError), {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Reaction added: ${body.emoji}`);
  return 0;
}

async function runHeard(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const { body, headers } = identifiedReaction(runtime, flags, room, {
    reactorHandle: requireFlag(flags, 'handle', CliInputError),
    emoji: HEARD_READ_EMOJI
  });
  const payload = await fetchJson(runtime, reactionPath(flags, CliInputError), {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Heard/read reaction added: ${HEARD_READ_EMOJI}`);
  return 0;
}

async function runRemove(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const { body, headers } = identifiedReaction(runtime, flags, room, {
    reactorHandle: requireFlag(flags, 'handle', CliInputError),
    emoji: requireFlag(flags, 'emoji', CliInputError)
  });
  const payload = await fetchJson(runtime, reactionPath(flags, CliInputError), {
    method: 'DELETE', headers, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Reaction removed: ${body.emoji}`);
  return 0;
}
