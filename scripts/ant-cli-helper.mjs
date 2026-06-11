/**
 * ant helper — attachment lifecycle (issuance-class witness).
 *
 *   ant helper pair --handle @x [--role reader|agent] [--owner @o]... [--ttl 15m] [--json] [--admin-token T]
 *   ant helper redeem <code> [--host NAME] [--json]
 *   ant helper leases [--handle @x] [--json] [--admin-token T]
 *   ant helper revoke <leaseId> [--json] [--admin-token T]
 *
 * pair mints a single-use pairing code (15-min TTL by default) for a handle.
 * The code must be handed over privately — NEVER paste a pairing code in a
 * room: redeem is open, so anyone reading the room could take the lease.
 * redeem swaps a live code for a lease; the leaseSecret is shown ONCE.
 * leases lists active attachments (metadata only, never secrets).
 * revoke is one row — the attachment is instantly deaf.
 *
 * pair/leases/revoke are operator-gated (admin-bearer or operator session); redeem is open
 * because the code IS the credential.
 */

const BOOLEAN_FLAGS = new Set(['json']);
const TTL_PATTERN = /^(\d+)(s|m|h)?$/;

export async function handleHelperVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const { flags, positionals } = parseArgs(args, CliInputError);
  switch (action) {
    case 'pair': return runPair(flags, runtime, CliInputError);
    case 'redeem': return runRedeem(positionals, flags, runtime, CliInputError);
    case 'leases': return runLeases(flags, runtime, CliInputError);
    case 'revoke': return runRevoke(positionals, flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown helper verb: ${action}`);
}

function parseArgs(rawArgs, CliInputError) {
  const flags = {};
  const positionals = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) { positionals.push(token); cursor += 1; continue; }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    if (name === 'owner') (flags.owners ??= []).push(value);
    else flags[name] = value;
    cursor += 2;
  }
  return { flags, positionals };
}

function writeUsage(runtime) {
  runtime.writeOut(`ant helper <pair|redeem|leases|revoke> [flags]
  pair --handle @x [--role reader|agent] [--owner @o]... [--ttl 15m] [--json]
  redeem <code> [--host NAME] [--json]
  leases [--handle @x] [--json]
  revoke <leaseId> [--json]`);
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

function parseTtlMs(rawTtl, CliInputError) {
  if (rawTtl === undefined) return undefined;
  const match = String(rawTtl).trim().toLowerCase().match(TTL_PATTERN);
  if (!match) throw new CliInputError(`--ttl must look like 15m, 900s, or 1h (got "${rawTtl}")`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 'm';
  if (unit === 'h') return amount * 3600 * 1000;
  if (unit === 's') return amount * 1000;
  return amount * 60 * 1000;
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

async function runPair(flags, runtime, CliInputError) {
  const handle = requireFlag(flags, 'handle', CliInputError);
  const adminToken = resolveAdminToken(flags, CliInputError);
  if (flags.role !== undefined && flags.role !== 'reader' && flags.role !== 'agent') {
    throw new CliInputError("--role must be 'reader' or 'agent'");
  }
  const body = { handle };
  if (flags.role) body.role = flags.role;
  if (Array.isArray(flags.owners) && flags.owners.length > 0) body.owners = flags.owners;
  const ttlMs = parseTtlMs(flags.ttl, CliInputError);
  if (ttlMs !== undefined) body.ttlMs = ttlMs;

  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/helper/pairing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    runtime.writeErr('Pair failed (401): operator login or admin bearer required');
    return 1;
  }
  if (!response.ok) {
    runtime.writeErr(`Pair failed (${response.status}): ${await readError(response, [adminToken])}`);
    return 1;
  }
  const payload = await response.json();
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  runtime.writeOut(`Pairing code: ${payload.code}`);
  runtime.writeOut(`handle: ${payload.handle}`);
  runtime.writeOut(`role: ${payload.role}`);
  runtime.writeOut(`pairingId: ${payload.pairingId}`);
  runtime.writeOut(`single-use, expires ${new Date(payload.expiresAtMs).toLocaleTimeString()} — hand over privately; NEVER paste a pairing code in a room`);
  return 0;
}

async function runRedeem(positionals, flags, runtime, CliInputError) {
  const code = positionals[0];
  if (!code) throw new CliInputError('redeem requires a pairing code: ant helper redeem <code>');
  const body = { code };
  if (flags.host) body.host = flags.host;

  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/helper/pairing/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (response.status === 410) {
    runtime.writeErr('Redeem failed (410): code invalid, expired, or already used — ask the operator to mint a fresh one');
    return 1;
  }
  if (!response.ok) {
    runtime.writeErr(`Redeem failed (${response.status}): ${await readError(response, [code])}`);
    return 1;
  }
  const payload = await response.json();
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  runtime.writeOut(`handle: ${payload.handle}`);
  runtime.writeOut(`role: ${payload.role}`);
  runtime.writeOut(`leaseId: ${payload.leaseId}`);
  runtime.writeOut(`scope: ${Array.isArray(payload.scope) ? payload.scope.join(', ') : payload.scope}`);
  runtime.writeOut(`expiresAtMs: ${payload.expiresAtMs}`);
  runtime.writeOut(`leaseSecret: ${payload.leaseSecret}`);
  runtime.writeOut('shown once — store it now');
  return 0;
}

async function runLeases(flags, runtime, CliInputError) {
  const adminToken = resolveAdminToken(flags, CliInputError);
  const query = flags.handle ? `?handle=${encodeURIComponent(flags.handle)}` : '';
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/helper/leases${query}`, {
    method: 'GET', headers: { authorization: `Bearer ${adminToken}` }
  });
  if (response.status === 401) {
    runtime.writeErr('Leases failed (401): operator login or admin bearer required');
    return 1;
  }
  if (!response.ok) {
    runtime.writeErr(`Leases failed (${response.status}): ${await readError(response, [adminToken])}`);
    return 1;
  }
  const payload = await response.json();
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  const leases = payload.leases ?? [];
  if (leases.length === 0) { runtime.writeOut('No active attachments.'); return 0; }
  for (const lease of leases) {
    runtime.writeOut(`${lease.id}\t${lease.handle}\t${lease.role}\thost=${lease.pairedHost ?? '-'}\texpiresAtMs=${lease.expiresAtMs}\tlastSeenAtMs=${lease.lastSeenAtMs ?? '-'}`);
  }
  return 0;
}

async function runRevoke(positionals, flags, runtime, CliInputError) {
  const leaseId = positionals[0];
  if (!leaseId) throw new CliInputError('revoke requires a lease id: ant helper revoke <leaseId>');
  const adminToken = resolveAdminToken(flags, CliInputError);
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/helper/leases/${encodeURIComponent(leaseId)}/revoke`, {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}` }
  });
  if (response.status === 401) {
    runtime.writeErr('Revoke failed (401): operator login or admin bearer required');
    return 1;
  }
  if (response.status === 404) {
    runtime.writeErr('Revoke failed (404): no live lease with that id');
    return 1;
  }
  if (!response.ok) {
    runtime.writeErr(`Revoke failed (${response.status}): ${await readError(response, [adminToken])}`);
    return 1;
  }
  const payload = await response.json();
  if (flags.json !== undefined) { runtime.writeOut(JSON.stringify(payload)); return 0; }
  runtime.writeOut('lease revoked — the attachment is now deaf');
  return 0;
}
