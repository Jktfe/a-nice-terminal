/**
 * ant-cli-request — Stage B permission_requests CLI verb (plan milestone
 * p3-stage-b-permission-requests of ant-substrate-v0.2-2026-05-29).
 *
 * Wired into the ant-cli.mjs dispatcher as the `request` verb.
 *
 * Usage:
 *   ant request approve <request_id> [--scope once|always-for-room|always-for-agent]
 *   ant request deny <request_id> [--reason TEXT]
 *   ant request list [--approver]
 *   ant request show <request_id>
 *
 * Auth: pidChain threaded into every request body so the server resolves
 * caller identity for the approver gate. Admin-bearer falls through the
 * existing /api/permission-requests/* approver gate when set via the
 * caller's environment (no special flag here — bearer lives at the HTTP
 * layer in the existing ant-cli fetch wedge).
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const SCOPE_VALUES = new Set(['once', 'always-for-room', 'always-for-agent']);

export async function handleRequestVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === undefined || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action === undefined ? 1 : 0;
  }
  switch (action) {
    case 'approve':
      return runApprove(args, runtime, CliInputError);
    case 'deny':
      return runDeny(args, runtime, CliInputError);
    case 'list':
      return runList(args, runtime);
    case 'show':
      return runShow(args, runtime, CliInputError);
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown subcommand: request ${action}`);
  }
}

async function runApprove(args, runtime, CliInputError) {
  const positional = args.filter((token) => !token.startsWith('--'));
  const requestId = positional[0];
  if (!requestId) {
    throw new CliInputError('approve requires <request_id>');
  }
  const scope = readFlag(args, 'scope');
  if (scope !== null && !SCOPE_VALUES.has(scope)) {
    throw new CliInputError(
      `--scope must be one of: ${Array.from(SCOPE_VALUES).join(', ')}`
    );
  }
  const payload = { pidChain: processIdentityChain() };
  if (scope !== null) payload.decisionScope = scope;
  const url = `${runtime.serverUrl}/api/permission-requests/${requestId}/approve`;
  const response = await runtime.fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await readText(response);
    runtime.writeErr(
      `ant request approve failed (${response.status}): ${text.slice(0, 200)}`
    );
    return 1;
  }
  const body = await readJson(response);
  const grantId = body?.grant?.grantId ?? '?';
  const replayStatus = body?.replay?.status ?? 'none';
  runtime.writeOut(
    `Approved ${requestId} (grant=${grantId}, replay=${replayStatus}).`
  );
  if (body?.replay?.ready) {
    runtime.writeOut(
      'Pending action is ready_for_replay — the original caller can now retry.'
    );
  }
  return 0;
}

async function runDeny(args, runtime, CliInputError) {
  const positional = args.filter((token) => !token.startsWith('--'));
  const requestId = positional[0];
  if (!requestId) {
    throw new CliInputError('deny requires <request_id>');
  }
  const reason = readFlag(args, 'reason');
  const payload = { pidChain: processIdentityChain() };
  if (reason !== null) payload.reason = reason;
  const url = `${runtime.serverUrl}/api/permission-requests/${requestId}/deny`;
  const response = await runtime.fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await readText(response);
    runtime.writeErr(
      `ant request deny failed (${response.status}): ${text.slice(0, 200)}`
    );
    return 1;
  }
  runtime.writeOut(`Denied ${requestId}.`);
  return 0;
}

async function runList(args, runtime) {
  const asApprover = args.includes('--approver');
  const url = new URL('/api/permission-requests', runtime.serverUrl);
  url.searchParams.set('pidChain', JSON.stringify(processIdentityChain()));
  if (asApprover) url.searchParams.set('asApprover', '1');
  const response = await runtime.fetchImpl(url.toString(), {
    headers: { 'content-type': 'application/json' }
  });
  if (!response.ok) {
    const text = await readText(response);
    runtime.writeErr(
      `ant request list failed (${response.status}): ${text.slice(0, 200)}`
    );
    return 1;
  }
  const body = await readJson(response);
  const requests = Array.isArray(body?.requests) ? body.requests : [];
  if (requests.length === 0) {
    runtime.writeOut('(no pending requests)');
    return 0;
  }
  for (const req of requests) {
    runtime.writeOut(
      `${req.requestId}\t${req.requesterHandle}\t${req.action}\t--${req.targetKind} ${req.targetId}`
    );
  }
  return 0;
}

async function runShow(args, runtime, CliInputError) {
  const positional = args.filter((token) => !token.startsWith('--'));
  const requestId = positional[0];
  if (!requestId) {
    throw new CliInputError('show requires <request_id>');
  }
  const url = new URL(
    `/api/permission-requests/${requestId}`,
    runtime.serverUrl
  );
  url.searchParams.set('pidChain', JSON.stringify(processIdentityChain()));
  const response = await runtime.fetchImpl(url.toString(), {
    headers: { 'content-type': 'application/json' }
  });
  if (!response.ok) {
    const text = await readText(response);
    runtime.writeErr(
      `ant request show failed (${response.status}): ${text.slice(0, 200)}`
    );
    return 1;
  }
  const body = await readJson(response);
  const req = body?.request;
  if (!req) {
    runtime.writeErr('Malformed response: no request body');
    return 1;
  }
  runtime.writeOut(`request_id:        ${req.requestId}`);
  runtime.writeOut(`requester:         ${req.requesterHandle}`);
  runtime.writeOut(`action:            ${req.action}`);
  runtime.writeOut(`target:            --${req.targetKind} ${req.targetId}`);
  runtime.writeOut(`status:            ${req.status}`);
  if (req.reason) runtime.writeOut(`reason:            ${req.reason}`);
  if (req.decidedByHandle) {
    runtime.writeOut(`decided_by:        ${req.decidedByHandle}`);
  }
  if (Array.isArray(req.approverHandles) && req.approverHandles.length > 0) {
    const approverList = req.approverHandles
      .map((a) => `${a.handle}${a.preferred ? '*' : ''}`)
      .join(', ');
    runtime.writeOut(`approvers:         ${approverList}`);
  }
  const pa = body?.pendingAction;
  if (pa) {
    runtime.writeOut(`pending_action:    ${pa.httpMethod} ${pa.httpPath}`);
    runtime.writeOut(`replay_status:     ${pa.replayStatus ?? '(none)'}`);
    runtime.writeOut(`expires_at_ms:     ${pa.expiresAtMs}`);
  }
  return 0;
}

function readFlag(args, name) {
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === `--${name}`) {
      const value = args[i + 1];
      if (value !== undefined && !value.startsWith('--')) return value;
    }
  }
  return null;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function writeUsage(runtime) {
  runtime.writeOut(
    'ant request approve <request_id> [--scope once|always-for-room|always-for-agent]'
  );
  runtime.writeOut('ant request deny <request_id> [--reason TEXT]');
  runtime.writeOut('ant request list [--approver]');
  runtime.writeOut('ant request show <request_id>');
}
