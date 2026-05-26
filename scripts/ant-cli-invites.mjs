/**
 * ant invite — CLI verbs for the chat-invites endpoint baseline.
 *
 * Verbs:
 *   ant invite create --room R --label L --password P --kinds cli,mcp [--created-by H] [--admin-token T]
 *   ant invite list   --room R [--admin-token T]
 *   ant invite exchange --invite-id ID --password P --kind cli [--handle H]
 *   ant invite redeem  --room ROOM_ID --token TOKEN_SECRET
 *                       [--name N] [--agent-kind K] [--pane P] [--no-register]
 *   ant invite revoke  --invite-id ID [--admin-token T]
 *   ant invite join-url <url> --password P --handle @H [--print-token]
 *                       [--name N] [--agent-kind K] [--pane P] [--no-register]
 *
 * Admin tasks (create + list + revoke) require an admin bearer, supplied
 * via --admin-token flag or ANT_ADMIN_TOKEN env. CLI-side check happens
 * BEFORE the fetch so the request never leaves the machine without a
 * token. Exchange + join-url are password-gated only (the password
 * itself is the auth) and are never logged.
 *
 * Safety: tokenSecret is printed ONCE on successful exchange (or on
 * join-url with --print-token) and nowhere else. The admin-token value
 * and the password value are NEVER echoed to stdout or stderr, including
 * in error paths (see redactSensitive).
 *
 * F slice (NMT feedback msg_sd5f3sw30s, 2026-05-26): redeem + join-url
 * auto-register the calling tmux pane against the joined handle so
 * PTY-inject delivers without a separate `ant register` call. See
 * ant-cli-redeem-autoregister.mjs for the helper + reasoning.
 */

import { attemptAutoRegister, formatAutoRegisterOutcome } from './ant-cli-redeem-autoregister.mjs';

const ALLOWED_KINDS = new Set(['cli', 'mcp', 'web']);
const BOOLEAN_FLAGS = new Set(['print-token', 'no-register']);

// Verbs that accept positional arguments. parseFlags collects bare
// tokens into _positionals for these verbs instead of throwing on the
// "expected --flag" rule that protects typo detection elsewhere.
const POSITIONAL_VERBS = new Set(['join-url']);

export async function handleInviteVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const allowPositionals = POSITIONAL_VERBS.has(action);
  const flags = parseFlags(args, CliInputError, { allowPositionals });
  switch (action) {
    case 'create': return runCreate(flags, runtime, CliInputError);
    case 'list': return runList(flags, runtime, CliInputError);
    case 'exchange': return runExchange(flags, runtime, CliInputError);
    case 'redeem': return runRedeem(flags, runtime, CliInputError);
    case 'revoke': return runRevoke(flags, runtime, CliInputError);
    case 'join-url': return runJoinUrl(flags, runtime, CliInputError);
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

function parseFlags(rawArgs, CliInputError, opts = {}) {
  const { allowPositionals = false } = opts;
  const collected = {};
  const positionals = [];
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      if (allowPositionals) {
        positionals.push(token);
        cursor += 1;
        continue;
      }
      throw new CliInputError(`expected --flag, got "${token}"`);
    }
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
  if (allowPositionals) collected._positionals = positionals;
  return collected;
}

function writeUsage(runtime) {
  runtime.writeOut('ant invite <create|list|exchange|redeem|revoke|join-url> [flags]');
  runtime.writeOut('  create   --room R --label L --password P --kinds cli,mcp [--created-by H] [--admin-token T]');
  runtime.writeOut('  list     --room R [--admin-token T]');
  runtime.writeOut('  exchange --invite-id ID --password P --kind cli [--handle H]');
  runtime.writeOut('  redeem   --room ROOM_ID --token TOKEN_SECRET');
  runtime.writeOut('  revoke   --invite-id ID [--admin-token T]');
  runtime.writeOut('  join-url <url> --password P --handle @H [--print-token]');
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
  // Tab-separated machine-readable line preserved for script consumers.
  runtime.writeOut(`${parsed.member.handle}\t${parsed.room.name}\t${parsed.room.id}`);

  // F slice — auto-register the calling pane so PTY-inject can deliver.
  // Failure is best-effort: never changes the redeem exit code.
  const outcome = await attemptAutoRegister({
    handle: parsed.member.handle,
    roomId: parsed.room.id,
    baseUrl: runtime.serverUrl,
    runtime,
    flags,
    envTmuxPane: process.env.TMUX_PANE
  });
  runtime.writeOut(formatAutoRegisterOutcome(outcome, parsed.member.handle, parsed.room.id));
  return 0;
}

/**
 * Parse the share-URL forms emitted by /mcp/room/[roomId] and the
 * accounts/web invite flow. Returns { origin, roomId, inviteId } if
 * recognised, else null.
 *
 * Recognised shapes:
 *   https://<host>/mcp/room/<ROOM>?invite=<INV>[&...]
 *   https://<host>/r/<ROOM>?invite=<INV>
 *   ant://<host>/room/<ROOM>?invite=<INV>
 *
 * For an absolute URL we use the WHATWG URL parser so query-string
 * decoding is correct; for ant:// schemes the parser still works because
 * the host + pathname components are well-formed.
 */
export function parseJoinUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const path = url.pathname;
  const roomMatch = path.match(/^\/(?:mcp\/room|r|room)\/([A-Za-z0-9_-]+)\/?$/);
  if (!roomMatch) return null;
  const roomId = roomMatch[1];
  const inviteId = url.searchParams.get('invite');
  if (!inviteId) return null;
  // For ant:// or any non-http scheme, the home server should still be
  // reached over https. Rewrite the protocol but keep host+port intact.
  const origin = url.protocol === 'http:' || url.protocol === 'https:'
    ? `${url.protocol}//${url.host}`
    : `https://${url.host}`;
  return { origin, roomId, inviteId };
}

async function runJoinUrl(flags, runtime, CliInputError) {
  const positional = (flags._positionals ?? [])[0];
  const urlFromFlag = typeof flags.url === 'string' ? flags.url : undefined;
  const rawUrl = positional ?? urlFromFlag;
  if (!rawUrl) {
    throw new CliInputError('join-url requires a URL (positional arg or --url)');
  }
  const parsed = parseJoinUrl(rawUrl);
  if (!parsed) {
    throw new CliInputError(`could not parse invite URL: ${rawUrl}`);
  }
  const password = requireFlag(flags, 'password', CliInputError);
  const handle = requireFlag(flags, 'handle', CliInputError);
  const printToken = flags['print-token'] === 'true';

  // Hit the URL's origin, not runtime.serverUrl — the share-URL ALWAYS
  // names the home server it belongs to. Cross-host join would silently
  // join the wrong server otherwise.
  const baseUrl = parsed.origin;

  const exchangeResponse = await runtime.fetchImpl(
    `${baseUrl}/api/chat-invites/${encodeURIComponent(parsed.inviteId)}/exchange`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, kind: 'cli', handle })
    }
  );
  if (!exchangeResponse.ok) {
    runtime.writeErr(`Exchange failed (${exchangeResponse.status}): ${await readErrorMessage(exchangeResponse, [password])}`);
    return 1;
  }
  const exchangeBody = await exchangeResponse.json();
  const tokenSecret = exchangeBody.tokenSecret;
  if (typeof tokenSecret !== 'string' || tokenSecret.length === 0) {
    runtime.writeErr('Exchange returned no tokenSecret — server contract violation');
    return 1;
  }

  const redeemResponse = await runtime.fetchImpl(
    `${baseUrl}/api/chat-rooms/${encodeURIComponent(parsed.roomId)}/join-with-token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenSecret })
    }
  );
  if (!redeemResponse.ok) {
    runtime.writeErr(`Redeem failed (${redeemResponse.status}): ${await readErrorMessage(redeemResponse, [tokenSecret])}`);
    return 1;
  }
  const redeemBody = await redeemResponse.json();

  // One-line success summary. tokenSecret is gated behind --print-token
  // because the common bash-agent path doesn't need it on stdout (the
  // membership is durable; future calls auth via cookie or admin-bearer).
  runtime.writeOut(`${redeemBody.member.handle}\t${redeemBody.room.name}\t${redeemBody.room.id}\t${baseUrl}`);
  if (printToken) {
    runtime.writeOut(tokenSecret);
  }

  // F slice — auto-register the calling pane against the joined handle.
  // Note we target `baseUrl` (the share-URL's home server), not
  // runtime.serverUrl, because the membership lives on baseUrl. Best-effort:
  // never changes the redeem exit code.
  const outcome = await attemptAutoRegister({
    handle: redeemBody.member.handle,
    roomId: redeemBody.room.id,
    baseUrl,
    runtime,
    flags,
    envTmuxPane: process.env.TMUX_PANE
  });
  runtime.writeOut(formatAutoRegisterOutcome(outcome, redeemBody.member.handle, redeemBody.room.id));
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
