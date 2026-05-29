/**
 * ant reclaim — super-admin reclaim CLI (PR-C, substrate v0.2 plan,
 * 2026-05-29).
 *
 * Replaces tonight's identity-surgery 4-hour raw-SQL forensic with a
 * 2-line audited recovery primitive.
 *
 * Verbs:
 *   ant reclaim file    --target-kind KIND --target-id ID --reason TEXT
 *                       [--diagnostic-file PATH] [--admin-token TOK]
 *   ant reclaim list    [--admin-token TOK]
 *   ant reclaim show    RECLAIM_ID [--admin-token TOK]
 *   ant reclaim execute RECLAIM_ID [--dry-run] [--admin-token TOK]
 *   ant reclaim deny    RECLAIM_ID --reason TEXT [--admin-token TOK]
 *
 * --admin-token overrides ANT_ADMIN_TOKEN env. Stage A scope:
 * admin-bearer is the only auth surface. Future Part-4 trust_pubkey lift
 * adds an org-admin attestation layer; this CLI shape stays the same
 * but the server gate widens.
 *
 * 9-year-old-readable. Stay under 260 lines.
 */

import { readFileSync } from 'node:fs';

const BOOLEAN_FLAGS = new Set(['dry-run']);
const VALID_KINDS = new Set(['terminal', 'membership', 'identity', 'session']);

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  const positionals = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      positionals.push(token);
      cursor += 1;
      continue;
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = 'true';
      cursor += 1;
      continue;
    }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliInputError(`flag --${name} needs a value`);
    }
    flags[name] = value;
    cursor += 2;
  }
  return { flags, positionals };
}

function writeUsage(runtime) {
  runtime.writeOut('ant reclaim <file|list|show|execute|deny>');
  runtime.writeOut('  reclaim file    --target-kind <terminal|membership|identity|session>');
  runtime.writeOut('                  --target-id <id> --reason "..." [--diagnostic-file PATH]');
  runtime.writeOut('                  [--admin-token TOK]');
  runtime.writeOut('  reclaim list    [--admin-token TOK]');
  runtime.writeOut('  reclaim show    <reclaim_id> [--admin-token TOK]');
  runtime.writeOut('  reclaim execute <reclaim_id> [--dry-run] [--admin-token TOK]');
  runtime.writeOut('  reclaim deny    <reclaim_id> --reason "..." [--admin-token TOK]');
}

function resolveAdminToken(flags, CliInputError) {
  const supplied = flags['admin-token'] ?? process.env.ANT_ADMIN_TOKEN;
  if (!supplied || supplied.length === 0) {
    throw new CliInputError(
      'admin token required (set ANT_ADMIN_TOKEN env or pass --admin-token)'
    );
  }
  return supplied;
}

async function sendAdminJson(runtime, path, method, token, body) {
  const url = `${runtime.serverUrl}${path}`;
  const init = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    }
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await runtime.fetchImpl(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return response.json();
}

async function sendAdminGet(runtime, path, token) {
  const url = `${runtime.serverUrl}${path}`;
  const response = await runtime.fetchImpl(url, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${path} -> ${response.status}: ${text}`);
  }
  return response.json();
}

function loadDiagnosticFile(path, CliInputError) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new CliInputError(`could not read --diagnostic-file ${path}: ${cause.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new CliInputError(`--diagnostic-file ${path} is not valid JSON: ${cause.message}`);
  }
}

function formatReclaimLine(reclaim) {
  const reason = reclaim.reason.length > 60
    ? reclaim.reason.slice(0, 57) + '...'
    : reclaim.reason;
  return `${reclaim.reclaimId}  [${reclaim.status}]  ${reclaim.targetKind}:${reclaim.targetId}  ${reason}`;
}

async function runFile(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  if (!flags['target-kind']) {
    throw new CliInputError('reclaim file needs --target-kind <terminal|membership|identity|session>');
  }
  if (!VALID_KINDS.has(flags['target-kind'])) {
    throw new CliInputError(`--target-kind must be one of: ${[...VALID_KINDS].join(', ')}`);
  }
  if (!flags['target-id']) {
    throw new CliInputError('reclaim file needs --target-id <id>');
  }
  if (!flags.reason) {
    throw new CliInputError('reclaim file needs --reason "..."');
  }
  const token = resolveAdminToken(flags, CliInputError);
  const body = {
    targetKind: flags['target-kind'],
    targetId: flags['target-id'],
    reason: flags.reason
  };
  if (flags['diagnostic-file']) {
    body.diagnostic = loadDiagnosticFile(flags['diagnostic-file'], CliInputError);
  }
  const result = await sendAdminJson(runtime, '/api/reclaim-requests', 'POST', token, body);
  const req = result?.request ?? {};
  runtime.writeOut(`filed ${req.reclaimId ?? '(unknown)'}  [${req.status ?? 'pending'}]  ${req.targetKind}:${req.targetId}`);
  return 0;
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const token = resolveAdminToken(flags, CliInputError);
  const result = await sendAdminGet(runtime, '/api/reclaim-requests', token);
  const rows = result?.requests ?? [];
  if (rows.length === 0) {
    runtime.writeOut('(no pending reclaim requests)');
    return 0;
  }
  for (const row of rows) runtime.writeOut(formatReclaimLine(row));
  return 0;
}

async function runShow(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const reclaimId = positionals[0];
  if (!reclaimId) {
    throw new CliInputError('reclaim show needs a reclaim_id');
  }
  const token = resolveAdminToken(flags, CliInputError);
  const result = await sendAdminGet(
    runtime,
    `/api/reclaim-requests/${encodeURIComponent(reclaimId)}`,
    token
  );
  runtime.writeOut(JSON.stringify(result?.request ?? null, null, 2));
  return 0;
}

async function runExecute(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const reclaimId = positionals[0];
  if (!reclaimId) {
    throw new CliInputError('reclaim execute needs a reclaim_id');
  }
  const token = resolveAdminToken(flags, CliInputError);
  const body = {};
  if (flags['dry-run']) body.dryRun = true;
  const result = await sendAdminJson(
    runtime,
    `/api/reclaim-requests/${encodeURIComponent(reclaimId)}/execute`,
    'POST',
    token,
    body
  );
  const req = result?.request ?? {};
  const actions = result?.actions ?? [];
  const banner = flags['dry-run']
    ? `dry-run ${reclaimId}  [${req.status}]  (no rows mutated)`
    : `executed ${reclaimId}  [${req.status}]`;
  runtime.writeOut(banner);
  for (const action of actions) {
    runtime.writeOut(`  - ${action.kind}: ${action.detail}  (rows=${action.rowsAffected})`);
  }
  return 0;
}

async function runDeny(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const reclaimId = positionals[0];
  if (!reclaimId) {
    throw new CliInputError('reclaim deny needs a reclaim_id');
  }
  if (!flags.reason) {
    throw new CliInputError('reclaim deny needs --reason "..."');
  }
  const token = resolveAdminToken(flags, CliInputError);
  const result = await sendAdminJson(
    runtime,
    `/api/reclaim-requests/${encodeURIComponent(reclaimId)}/deny`,
    'POST',
    token,
    { reason: flags.reason }
  );
  const req = result?.request ?? {};
  runtime.writeOut(`denied ${req.reclaimId ?? reclaimId}  [${req.status ?? 'denied'}]`);
  return 0;
}

export async function handleReclaimVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  switch (action) {
    case 'file':    return runFile(args, runtime, CliInputError);
    case 'list':    return runList(args, runtime, CliInputError);
    case 'show':    return runShow(args, runtime, CliInputError);
    case 'execute': return runExecute(args, runtime, CliInputError);
    case 'deny':    return runDeny(args, runtime, CliInputError);
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown reclaim verb: ${action}`);
  }
}
