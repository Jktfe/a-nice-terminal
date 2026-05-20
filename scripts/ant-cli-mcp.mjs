/**
 * ant mcp — admin lifecycle for MCP adapter room grants.
 *
 *   ant mcp list --room R [--include-revoked] [--json] [--admin-token T]
 *   ant mcp grant --room R --handle @h [--label L] [--json] [--admin-token T]
 *   ant mcp revoke --token-id tok_x [--json] [--admin-token T]
 *
 * The grant tokenSecret is printed once on creation only. List/revoke output
 * never prints token bytes.
 */

const BOOLEAN_FLAGS = new Set(['json', 'include-revoked']);

export async function handleMcpVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'list': return runList(flags, runtime, CliInputError);
    case 'grant': return runGrant(flags, runtime, CliInputError);
    case 'revoke': return runRevoke(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown mcp verb: ${action}`);
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
  runtime.writeOut('ant mcp <list|grant|revoke> [flags]');
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) throw new CliInputError(`missing required flag --${name}`);
  return value;
}

function resolveAdminToken(flags, CliInputError) {
  const fromFlag = flags['admin-token'];
  if (typeof fromFlag === 'string' && fromFlag.length > 0) return fromFlag;
  const fromEnv = process.env.ANT_ADMIN_TOKEN;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  throw new CliInputError('admin token required: pass --admin-token or set ANT_ADMIN_TOKEN');
}

function redact(text, values) {
  let out = text;
  for (const value of values) if (value) out = out.split(value).join('***REDACTED***');
  return out;
}

async function readError(response, secrets) {
  const text = await response.text().catch(() => '');
  return redact(text.slice(0, 300), secrets);
}

function writeJsonOrText(runtime, flags, payload, text) {
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(text);
}

async function fetchJson(runtime, path, init, failureLabel, secrets) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    runtime.writeErr(`${failureLabel} failed (${response.status}): ${await readError(response, secrets)}`);
    return null;
  }
  return response.json();
}

async function runList(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const adminToken = resolveAdminToken(flags, CliInputError);
  const revoked = flags['include-revoked'] !== undefined ? '&includeRevoked=1' : '';
  const payload = await fetchJson(runtime, `/api/mcp/grants?roomId=${encodeURIComponent(room)}${revoked}`, {
    method: 'GET', headers: { authorization: `Bearer ${adminToken}` }
  }, 'List', [adminToken]);
  if (!payload) return 1;
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  for (const g of payload.grants ?? []) runtime.writeOut(`${g.token_id}\t${g.handle}\t${g.label}\t${g.revoked_at ? 'revoked' : 'active'}`);
  return 0;
}

async function runGrant(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const handle = requireFlag(flags, 'handle', CliInputError);
  const adminToken = resolveAdminToken(flags, CliInputError);
  const body = { roomId: room, handle };
  if (flags.label) body.label = flags.label;
  const payload = await fetchJson(runtime, '/api/mcp/grants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body)
  }, 'Grant', [adminToken]);
  if (!payload) return 1;
  writeJsonOrText(runtime, flags, payload, `tokenSecret ${payload.tokenSecret}\nGrant ${payload.grant.token_id} ${payload.grant.handle} ${payload.grant.label}`);
  return 0;
}

async function runRevoke(flags, runtime, CliInputError) {
  const tokenId = requireFlag(flags, 'token-id', CliInputError);
  const adminToken = resolveAdminToken(flags, CliInputError);
  const payload = await fetchJson(runtime, `/api/mcp/grants/${encodeURIComponent(tokenId)}/revoke`, {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}` }
  }, 'Revoke', [adminToken]);
  if (!payload) return 1;
  writeJsonOrText(runtime, flags, payload, `Revoked MCP grant ${payload.token_id}`);
  return 0;
}
