const BOOLEAN_FLAGS = new Set(['json']);
const HEARD_READ_EMOJI = '🧏‍♂️';

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
  const payload = await fetchJson(runtime, reactionPath(flags, CliInputError));
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const reaction of payload.reactions ?? []) {
    runtime.writeOut(`${reaction.reactorHandle}\t${reaction.emoji}`);
  }
  return 0;
}

async function runAdd(flags, runtime, CliInputError) {
  const body = {
    reactorHandle: requireFlag(flags, 'handle', CliInputError),
    emoji: requireFlag(flags, 'emoji', CliInputError)
  };
  const payload = await fetchJson(runtime, reactionPath(flags, CliInputError), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Reaction added: ${body.emoji}`);
  return 0;
}

async function runHeard(flags, runtime, CliInputError) {
  const body = {
    reactorHandle: requireFlag(flags, 'handle', CliInputError),
    emoji: HEARD_READ_EMOJI
  };
  const payload = await fetchJson(runtime, reactionPath(flags, CliInputError), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Heard/read reaction added: ${HEARD_READ_EMOJI}`);
  return 0;
}

async function runRemove(flags, runtime, CliInputError) {
  const body = {
    reactorHandle: requireFlag(flags, 'handle', CliInputError),
    emoji: requireFlag(flags, 'emoji', CliInputError)
  };
  const payload = await fetchJson(runtime, reactionPath(flags, CliInputError), {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Reaction removed: ${body.emoji}`);
  return 0;
}
