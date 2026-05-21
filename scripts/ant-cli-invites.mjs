/**
 * ant invite — CLI verbs for the chat-invites endpoint baseline.
 *
 * Verbs:
 *   ant invite create --room R --label L --password P --kinds cli,mcp [--created-by H] [--admin-token T]
 *   ant invite list   --room R [--admin-token T]
 *   ant invite exchange --invite-id ID --password P --kind cli [--handle H]
 *
 * Admin tasks (create + list) require an admin bearer, supplied via
 * --admin-token flag or ANT_ADMIN_TOKEN env. CLI-side check happens
 * BEFORE the fetch so the request never leaves the machine without a
 * token. Exchange is password-gated only (the password itself is the
 * auth) and never logged.
 *
 * Safety: tokenSecret is printed ONCE on successful exchange and nowhere
 * else. The admin-token value and the password value are NEVER echoed
 * to stdout or stderr, including in error paths.
 */

const ALLOWED_KINDS = new Set(['cli', 'mcp', 'web']);
const BOOLEAN_FLAGS = new Set([]);

export async function handleInviteVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'create': return runCreate(flags, runtime, CliInputError);
    case 'list': return runList(flags, runtime, CliInputError);
    case 'exchange': return runExchange(flags, runtime, CliInputError);
    case 'redeem': return runRedeem(flags, runtime, CliInputError);
    case 'revoke': return runRevoke(flags, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action === undefined ? 1 : 0;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown invite verb: ${action}`);
  }
}

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
      collected[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const flagValue = rawArgs[cursor + 1];
    if (flagValue === undefined || flagValue.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    collected[flagName] = flagValue;
    cursor += 2;
  }
  return collected;
}

function writeUsage(runtime) {
  runtime.writeOut('ant invite <create|list|exchange|redeem|revoke> [flags]');
  runtime.writeOut('  create --room R --label L --password P --kinds cli,mcp [--created-by H] [--admin-token T]');
  runtime.writeOut('  list   --room R [--admin-token T]');
  runtime.writeOut('  exchange --invite-id ID --password P --kind cli [--handle H]');
  runtime.writeOut('  redeem --room ROOM_ID --token TOKEN_SECRET');
  runtime.writeOut('  revoke --invite-id ID [--admin-token T]');
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

function resolveAdminToken(flags, CliInputError) {
  const fromFlag = flags['admin-token'];
  if (typeof fromFlag === 'string' && fromFlag.length > 0) return fromFlag;
  const fromEnv = process.env.ANT_ADMIN_TOKEN;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  throw new CliInputError('admin token required: pass --admin-token or set ANT_ADMIN_TOKEN');
}

function parseKindsList(raw, CliInputError) {
  const parts = raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (parts.length === 0) throw new CliInputError('flag --kinds must list at least one of cli, mcp, web');
  for (const part of parts) {
    if (!ALLOWED_KINDS.has(part)) {
      throw new CliInputError(`flag --kinds has unknown value: ${part}`);
    }
  }
  return parts;
}

function requireKindEnum(raw, CliInputError) {
  if (!ALLOWED_KINDS.has(raw)) {
    throw new CliInputError(`flag --kind must be one of cli, mcp, web`);
  }
  return raw;
}

function redactSensitive(text, sensitiveValues) {
  let out = text;
  for (const secret of sensitiveValues) {
    if (typeof secret === 'string' && secret.length > 0) {
      out = out.split(secret).join('***REDACTED***');
    }
  }
  return out;
}

async function readErrorMessage(response, sensitiveValues = []) {
  try {
    const body = await response.text();
    if (body.length === 0) return '';
    return redactSensitive(body.slice(0, 300), sensitiveValues);
  } catch {
    return '';
  }
}

async function runCreate(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const label = requireFlag(flags, 'label', CliInputError);
  const password = requireFlag(flags, 'password', CliInputError);
  const kindsRaw = requireFlag(flags, 'kinds', CliInputError);
  const kinds = parseKindsList(kindsRaw, CliInputError);
  const adminToken = resolveAdminToken(flags, CliInputError);
  const body = { roomId: room, label, password, kinds };
  if (flags['created-by']) body.createdBy = flags['created-by'];
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/chat-invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    runtime.writeErr(`Create failed (${response.status}): ${await readErrorMessage(response, [adminToken, password])}`);
    return 1;
  }
  const parsed = await response.json();
  runtime.writeOut(`${parsed.invite.id}\t${parsed.invite.room_id}\t${parsed.invite.label}`);
  return 0;
}

async function runList(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const adminToken = resolveAdminToken(flags, CliInputError);
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/chat-invites?roomId=${encodeURIComponent(room)}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  if (!response.ok) {
    runtime.writeErr(`List failed (${response.status}): ${await readErrorMessage(response, [adminToken])}`);
    return 1;
  }
  const parsed = await response.json();
  for (const invite of parsed.invites ?? []) {
    runtime.writeOut(`${invite.id}\t${invite.label}\t${invite.kinds.join(',')}`);
  }
  return 0;
}

async function runExchange(flags, runtime, CliInputError) {
  const inviteId = requireFlag(flags, 'invite-id', CliInputError);
  const password = requireFlag(flags, 'password', CliInputError);
  const kindRaw = requireFlag(flags, 'kind', CliInputError);
  const kind = requireKindEnum(kindRaw, CliInputError);
  const body = { password, kind };
  if (flags.handle) body.handle = flags.handle;
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/chat-invites/${encodeURIComponent(inviteId)}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    runtime.writeErr(`Exchange failed (${response.status}): ${await readErrorMessage(response, [password])}`);
    return 1;
  }
  const parsed = await response.json();
  runtime.writeOut(parsed.tokenSecret);
  return 0;
}

async function runRedeem(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const tokenSecret = requireFlag(flags, 'token', CliInputError);
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(room)}/join-with-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tokenSecret })
  });
  if (!response.ok) {
    runtime.writeErr(`Redeem failed (${response.status}): ${await readErrorMessage(response, [tokenSecret])}`);
    return 1;
  }
  const parsed = await response.json();
  runtime.writeOut(`${parsed.member.handle}\t${parsed.room.name}\t${parsed.room.id}`);
  return 0;
}

async function runRevoke(flags, runtime, CliInputError) {
  const inviteId = requireFlag(flags, 'invite-id', CliInputError);
  const adminToken = resolveAdminToken(flags, CliInputError);
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/chat-invites/${encodeURIComponent(inviteId)}/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  if (!response.ok) {
    runtime.writeErr(`Revoke failed (${response.status}): ${await readErrorMessage(response, [adminToken])}`);
    return 1;
  }
  const parsed = await response.json();
  runtime.writeOut(`Revoked invite ${parsed.invite_id}`);
  return 0;
}
