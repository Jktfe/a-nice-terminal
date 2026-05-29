/**
 * ant admin — super-admin verbs (today: reclaim).
 *
 *   ant admin reclaim --agent <agentId> --new-runtime <terminalId>
 *                     [--old-runtime <id>] [--challenge <token>]
 *                     [--requested-by <agentId>] [--auto-approve]
 *                     [--admin-token T] [--json]
 *
 * v0.2 PR-C: the recovery primitive itself. Replaces today's 4-hour SQL
 * forensic with a 2-line CLI invocation. Spec at
 * docs/concepts/ant-v02-identity-and-recovery.md §Recovery Layer +
 * §TigerResearch Recovery Flow.
 *
 * Single-agent reclaim only this PR. Fleet --all-stale ships in PR-D+.
 *
 * Admin token resolution mirrors ant-cli-grant.mjs:
 *   1. --admin-token flag (highest precedence — explicit override)
 *   2. ANT_ADMIN_TOKEN env var
 *   3. ANT_ADMIN_TOKEN= line in ~/.ant/secrets.env (chmod 600)
 *
 * No-token error prints the recovery command so an operator can fix and
 * re-run in one step.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BOOLEAN_FLAGS = new Set(['json', 'auto-approve']);

export async function handleAdminVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === 'reclaim') {
    const flags = parseFlags(args, CliInputError);
    return runReclaim(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown admin verb: ${action}`);
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
  runtime.writeOut('ant admin reclaim --agent <agentId> --new-runtime <terminalId> [--old-runtime <id>] [--challenge <token>] [--requested-by <agentId>] [--auto-approve] [--admin-token T] [--json]');
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
  const fromFile = readAdminTokenFromSecretsFile();
  if (fromFile) return fromFile;
  throw new CliInputError(
    'admin token required. Set ANT_ADMIN_TOKEN in ~/.ant/secrets.env first ' +
    '(or pass --admin-token / export ANT_ADMIN_TOKEN).'
  );
}

function readAdminTokenFromSecretsFile() {
  // ANT_SECRETS_FILE wins so tests can point at a fixture without touching
  // the operator's real ~/.ant/secrets.env on disk.
  const explicit = process.env.ANT_SECRETS_FILE;
  const secretsPath = explicit && explicit.length > 0
    ? explicit
    : join(homedir(), '.ant', 'secrets.env');
  if (!existsSync(secretsPath)) return null;
  let raw;
  try { raw = readFileSync(secretsPath, 'utf8'); } catch { return null; }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ANT_ADMIN_TOKEN=')) {
      const value = trimmed.slice('ANT_ADMIN_TOKEN='.length);
      return value.replace(/^"|"$/g, '');
    }
  }
  return null;
}

function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('***REDACTED***');
  return out;
}

async function runReclaim(flags, runtime, CliInputError) {
  const agentId = requireFlag(flags, 'agent', CliInputError);
  const newRuntimeId = requireFlag(flags, 'new-runtime', CliInputError);
  const adminToken = resolveAdminToken(flags, CliInputError);

  const oldRuntimeId = flags['old-runtime'] ?? null;
  // Challenge is the v0.2 placeholder for an ed25519 signed token. Until
  // signed challenges land, a randomly-generated opaque token is accepted
  // by the server (which doesn't verify the value yet).
  const challenge = flags.challenge ?? `cli-${Date.now().toString(36)}`;
  const requestedByAgentId = flags['requested-by'] ?? agentId;
  const autoApprove = flags['auto-approve'] === 'true';

  const body = {
    agentId,
    newRuntimeId,
    challenge,
    requestedByAgentId,
    autoApprove
  };
  if (oldRuntimeId) body.oldRuntimeId = oldRuntimeId;

  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/admin/reclaim?action=request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    runtime.writeErr(`Reclaim failed (${response.status}): ${redact(errorText.slice(0, 300), [adminToken])}`);
    return 1;
  }
  const payload = await response.json();
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
  } else {
    const affected = Array.isArray(payload.affectedRoomIds)
      ? `, ${payload.affectedRoomIds.length} room(s) re-bound`
      : '';
    runtime.writeOut(`${payload.requestId} ${payload.status}${affected}`);
  }
  // Reclaim succeeded server-side but the request may still be pending
  // (no --auto-approve). Surface a non-zero exit only on explicit
  // rejection so chained scripts can treat pending as "follow-up needed".
  if (payload.status === 'rejected') return 1;
  return 0;
}
