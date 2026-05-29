/**
 * POST /api/admin/reclaim — the recovery primitive.
 *
 * Two modes via `?action=` query param or body field:
 *
 *   action=request — create a reclaim_request.
 *     body: {
 *       agentId, oldRuntimeId?, newRuntimeId, challenge,
 *       requestedByAgentId, autoApprove?
 *     }
 *     if autoApprove=true, the same call atomically request -> approve ->
 *     execute (super-admin convenience — the caller already proved it is
 *     super-admin via the admin-bearer gate below).
 *
 *   action=approve — approve a pending reclaim_request and execute it.
 *     body: { requestId, approverAgentId }
 *
 * Auth: admin bearer (ANT_ADMIN_TOKEN). This is the v0.2 placeholder for
 * the eventual super-admin-key + 2FA gate per docs/concepts/ant-v02-
 * identity-and-recovery.md §The Key-Loss Recovery Story.
 *
 * Structured log line emitted on every successful execute per JWPK rule
 * — message id banked in MEMORY.md as msg_5xjtox2059.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  createReclaimRequest,
  approveReclaimRequest,
  executeReclaimRequest,
  getReclaimRequest
} from '$lib/server/reclaimRequestsStore';

type BodyShape = Record<string, unknown>;

async function parseBody(request: Request): Promise<BodyShape> {
  const text = await request.text();
  if (text.length === 0) throw error(400, 'Body must be a JSON object.');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as BodyShape;
  } catch (failure) {
    if (failure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw failure;
  }
}

function requireString(source: BodyShape, field: string): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw error(400, `Field ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw error(400, `Field ${field} must be a string when present.`);
  return value;
}

function resolveAction(url: URL, body: BodyShape): string {
  const fromQuery = url.searchParams.get('action');
  if (fromQuery && fromQuery.length > 0) return fromQuery;
  const fromBody = body.action;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  throw error(400, 'Query param ?action= or body.action must be set to "request" or "approve".');
}

function logReclaim(event: string, fields: Record<string, unknown>): void {
  // Structured single-line audit shape per JWPK rule (msg_5xjtox2059):
  // every successful reclaim leaves a forensic trail without writing into
  // a bespoke audit table — the line is the artefact.
  // eslint-disable-next-line no-console
  console.log(`[reclaim] ${event} ${JSON.stringify(fields)}`);
}

export const POST: RequestHandler = async ({ request, url }) => {
  requireAdminAuth(request);
  const body = await parseBody(request);
  const action = resolveAction(url, body);

  if (action === 'request') return handleRequestAction(body);
  if (action === 'approve') return handleApproveAction(body);
  throw error(400, `Unknown action "${action}". Expected "request" or "approve".`);
};

function handleRequestAction(body: BodyShape) {
  const agentId = requireString(body, 'agentId');
  const newRuntimeId = requireString(body, 'newRuntimeId');
  const challenge = requireString(body, 'challenge');
  const requestedByAgentId = requireString(body, 'requestedByAgentId');
  const oldRuntimeId = optionalString(body.oldRuntimeId, 'oldRuntimeId');
  const autoApprove = body.autoApprove === true;
  const now = Date.now();

  const created = createReclaimRequest({
    agentId,
    oldRuntimeId,
    newRuntimeId,
    challenge,
    requestedByAgentId,
    nowMs: now
  });
  logReclaim('request.created', {
    requestId: created.requestId,
    agentId,
    oldRuntimeId,
    newRuntimeId,
    requestedByAgentId
  });

  if (!autoApprove) {
    return json({ requestId: created.requestId, status: 'pending', expiresAtMs: created.expiresAtMs });
  }

  // Auto-approve path: caller is already super-admin (admin-bearer gate
  // ran above). The approver-agent-id collapses to the requested-by-agent
  // id since there's no human between the two steps.
  const approveResult = approveReclaimRequest({
    requestId: created.requestId,
    approverAgentId: requestedByAgentId,
    nowMs: Date.now()
  });
  if (!approveResult.ok) {
    // Should be impossible immediately after a successful create — surface
    // as 500 so an operator notices the invariant violation.
    throw error(500, `auto-approve failed: ${approveResult.reason}`);
  }
  const executeResult = executeReclaimRequest({
    requestId: created.requestId,
    nowMs: Date.now()
  });
  if (!executeResult.ok) {
    throw error(500, `auto-execute failed: ${executeResult.reason}`);
  }
  logReclaim('request.executed', {
    requestId: created.requestId,
    agentId,
    oldRuntimeId,
    newRuntimeId,
    affectedRoomIds: executeResult.affectedRoomIds,
    oldArchived: executeResult.oldArchived
  });
  return json({
    requestId: created.requestId,
    status: 'executed',
    affectedRoomIds: executeResult.affectedRoomIds,
    oldArchived: executeResult.oldArchived
  });
}

function handleApproveAction(body: BodyShape) {
  const requestId = requireString(body, 'requestId');
  const approverAgentId = requireString(body, 'approverAgentId');

  const initial = getReclaimRequest(requestId);
  if (!initial) throw error(404, 'reclaim_request not found');

  const approveResult = approveReclaimRequest({
    requestId,
    approverAgentId,
    nowMs: Date.now()
  });
  if (!approveResult.ok) {
    if (approveResult.reason === 'not-found') throw error(404, 'reclaim_request not found');
    if (approveResult.reason === 'expired') throw error(409, 'reclaim_request expired');
    if (approveResult.reason === 'not-pending') throw error(409, 'reclaim_request is not pending');
  }
  const executeResult = executeReclaimRequest({
    requestId,
    nowMs: Date.now()
  });
  if (!executeResult.ok) {
    if (executeResult.reason === 'expired') throw error(409, 'reclaim_request expired');
    if (executeResult.reason === 'not-found') throw error(404, 'reclaim_request not found');
    throw error(500, `execute failed: ${executeResult.reason}`);
  }
  logReclaim('request.executed', {
    requestId,
    agentId: initial.agent_id,
    oldRuntimeId: initial.old_runtime_id,
    newRuntimeId: initial.new_runtime_id,
    approverAgentId,
    affectedRoomIds: executeResult.affectedRoomIds,
    oldArchived: executeResult.oldArchived
  });
  return json({
    requestId,
    status: 'executed',
    affectedRoomIds: executeResult.affectedRoomIds,
    oldArchived: executeResult.oldArchived
  });
}
