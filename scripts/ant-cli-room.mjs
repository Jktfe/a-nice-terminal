import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { handleInviteVerb } from './ant-cli-invites.mjs';

const BOOLEAN_FLAGS = new Set(['json', 'toggle']);
const ALLOWED_MODES = ['brainstorm', 'heads-down', 'closed'];
const RESPONDER_VERB_FLAGS = ['set', 'add', 'remove', 'move'];

export async function handleRoomVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  // `room invite` is a thin delegation alias to handleInviteVerb. The first
  // arg here is the sub-action ("create" / "list" / "revoke" / etc); the rest
  // are the flag tokens that handleInviteVerb's own parser will read. Do this
  // BEFORE parseFlags so the sub-action token (a bare word, not --flag) does
  // not trip the room parser's --flag-required check.
  if (action === 'invite') return handleInviteVerb(args[0], args.slice(1), runtime, ctx);
  if (action && !action.startsWith('--') && ['add', 'remove'].includes(args[0])) {
    return runPositionalMemberEdit(action, args[0], args.slice(1), runtime, CliInputError);
  }
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'members': return runMembers(flags, runtime, CliInputError);
    case 'add-member': return runAddMember(flags, runtime, CliInputError);
    case 'remove-member': return runRemoveMember(flags, runtime, CliInputError);
    case 'aliases': return runAliases(flags, runtime, CliInputError);
    case 'set-alias': return runSetAlias(flags, runtime, CliInputError);
    case 'clear-alias': return runClearAlias(flags, runtime, CliInputError);
    case 'mode': return runMode(flags, runtime, CliInputError);
    case 'responders': return runResponders(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown room verb: ${action}`);
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
  runtime.writeOut('ant room <room-id> <add|remove> @handle');
  runtime.writeOut('ant room <members|add-member|remove-member|aliases|set-alias|clear-alias|mode|responders|invite> [flags]');
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

function adminHeaders() {
  const token = process.env.ANT_ADMIN_TOKEN ?? process.env.ANT_ADMIN_BEARER;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function runPositionalMemberEdit(room, action, args, runtime, CliInputError) {
  const handle = args[0];
  if (!handle || handle.trim().length === 0) {
    throw new CliInputError(`ant room ${room} ${action} needs a handle`);
  }
  const body = { handle: handle.trim(), pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/members/superadmin`, {
    method: action === 'add' ? 'POST' : 'DELETE',
    headers: { 'content-type': 'application/json', ...adminHeaders() },
    body: JSON.stringify(body)
  });
  if (action === 'add') {
    runtime.writeOut(`Member added: ${payload.handle ?? body.handle}`);
  } else {
    runtime.writeOut(`Member removed: ${body.handle}${payload.retiredAs ? ` (history: ${payload.retiredAs})` : ''}`);
  }
  return 0;
}

async function runMembers(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}`);
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const member of payload.chatRoom?.members ?? []) {
    runtime.writeOut(`${member.handle}\t${member.kind ?? 'member'}\t(joined ${member.joinedAt ?? 'unknown'})`);
  }
  return 0;
}

async function runAddMember(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const body = {
    agentHandle: requireFlag(flags, 'handle', CliInputError),
    pidChain: processIdentityChain()
  };
  if (flags['display-name']) body.agentDisplayName = flags['display-name'];
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/members`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Member added: ${body.agentHandle}`);
  return 0;
}

async function runRemoveMember(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const handle = requireFlag(flags, 'handle', CliInputError);
  // M3.6a-v1 T3 R3 transport-lock: DELETE carries pidChain in JSON body, not
  // query-string (avoids ps argv leak + matches POST identity convention).
  const body = { pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/members?globalHandle=${encodeURIComponent(handle)}`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Member removed: ${handle}`);
  return 0;
}

async function runAliases(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/aliases`);
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const alias of payload.aliases ?? []) runtime.writeOut(`${alias.globalHandle}\t${alias.alias}`);
  return 0;
}

async function runSetAlias(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const body = { globalHandle: requireFlag(flags, 'handle', CliInputError), newAlias: requireFlag(flags, 'alias', CliInputError) };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/aliases`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Alias set: ${body.globalHandle} -> ${body.newAlias}`);
  return 0;
}

async function runClearAlias(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const handle = requireFlag(flags, 'handle', CliInputError);
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/aliases?globalHandle=${encodeURIComponent(handle)}`, { method: 'DELETE' });
  writeJsonOrText(runtime, flags, payload, `Alias cleared: ${handle}`);
  return 0;
}

async function runMode(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const wantsToggle = flags.toggle !== undefined;
  const setRaw = flags.set;
  if (wantsToggle && setRaw !== undefined) {
    throw new CliInputError('--set and --toggle are mutually exclusive');
  }
  if (setRaw !== undefined) {
    return putMode(room, setRaw, flags, runtime, CliInputError);
  }
  if (wantsToggle) {
    return toggleMode(room, flags, runtime, CliInputError);
  }
  return readMode(room, flags, runtime);
}

async function readMode(room, flags, runtime) {
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/mode`);
  writeJsonOrText(runtime, flags, payload, `Mode for ${room}: ${payload.mode}`);
  return 0;
}

async function putMode(room, modeValue, flags, runtime, CliInputError) {
  if (!ALLOWED_MODES.includes(modeValue)) {
    throw new CliInputError(`--set must be one of: ${ALLOWED_MODES.join(', ')}`);
  }
  const requestBody = { mode: modeValue, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/mode`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  writeJsonOrText(runtime, flags, payload, `Set room mode to ${payload.mode} in ${room} (by ${payload.set_by ?? 'unknown'})`);
  return 0;
}

async function toggleMode(room, flags, runtime, CliInputError) {
  const current = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/mode`);
  if (current.mode === 'closed') {
    runtime.writeErr(`Room is closed. Use --set brainstorm|heads-down to leave closed.`);
    return 1;
  }
  const next = current.mode === 'brainstorm' ? 'heads-down' : 'brainstorm';
  return putMode(room, next, flags, runtime, CliInputError);
}

async function runResponders(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const active = RESPONDER_VERB_FLAGS.filter((name) => flags[name] !== undefined);
  if (active.length > 1) {
    throw new CliInputError(`--${active.join(' and --')} are mutually exclusive`);
  }
  if (active.length === 0) return listResponders(room, flags, runtime);
  if (active[0] === 'set') return putResponders(room, flags.set, flags, runtime);
  if (active[0] === 'add') return postResponder(room, flags.add, flags.at, flags, runtime);
  if (active[0] === 'remove') return deleteResponder(room, flags.remove, flags, runtime);
  return patchResponder(room, flags.move, flags.to, flags, runtime, CliInputError);
}

async function listResponders(room, flags, runtime) {
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/responders`);
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const r of payload.responders ?? []) runtime.writeOut(`${r.order_index}\t${r.handle}\t${r.pane_status}`);
  return 0;
}

async function putResponders(room, csv, flags, runtime) {
  const handles = csv.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const body = { handles, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/responders`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Set ${payload.responders.length} responders in ${room}`);
  return 0;
}

async function postResponder(room, handle, atRaw, flags, runtime) {
  const body = { handle, pidChain: processIdentityChain() };
  if (atRaw !== undefined) body.at = Number(atRaw);
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/responders`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Added responder ${handle} in ${room}`);
  return 0;
}

async function deleteResponder(room, handle, flags, runtime) {
  const body = { handle, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/responders`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Removed responder ${handle} in ${room}`);
  return 0;
}

async function patchResponder(room, handle, toRaw, flags, runtime, CliInputError) {
  if (toRaw === undefined) throw new CliInputError('--move requires --to <position>');
  const body = { handle, to: Number(toRaw), pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/responders`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Moved responder ${handle} to position ${toRaw} in ${room}`);
  return 0;
}
