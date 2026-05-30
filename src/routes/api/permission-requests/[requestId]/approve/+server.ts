/**
 * POST /api/permission-requests/:requestId/approve — Stage B substrate
 * (plan milestone p3-stage-b-permission-requests of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Body: { decisionScope?, pidChain? }
 *
 * Auth gate (mirrors /api/grants exactly):
 *   - admin-bearer bypasses;
 *   - else caller's resolved handle must appear in
 *     resolveApproversFor({targetKind, targetId}) — the SAME primitive
 *     that builds the Stage A 403 payload + gates Stage A's POST /api/grants.
 *   - non-approver → 403 with a structured permission_denied payload
 *     describing how to escalate.
 *
 * On approval, the store atomically writes a grants_shim row + flips the
 * pending_action's replay_status='ready_for_replay' (unless the
 * pending_action has already expired by wall clock — then it stays at
 * 'pending' and the sweep will mark it expired).
 *
 * Returns:
 *   200 { request, grant, replay: { status, ready, actionId? } }
 *
 * The CLI poller reads `replay.status` to decide whether to retry the
 * original action. Server-side replay is deliberately NOT implemented
 * here — the CLI calls back to the same endpoint with the new grant in
 * place. Avoids infinite-loop risk and keeps the debug surface simple.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  approveRequest,
  getPermissionRequest
} from '$lib/server/permissionRequestsStore';
import { resolveApproversFor } from '$lib/server/permissionApproverResolver';
import {
  buildPermissionDeniedPayload,
  type PermissionDeniedReason,
  type PermissionTargetKind
} from '$lib/server/permissionDeniedPayload';
import { ADMIN_BEARER_HANDLE } from '$lib/server/chatRoomAuthGate';
import { resolveAuthoritativeCallerHandle } from '$lib/server/permissionCallerIdentity';
import type { GrantScope } from '$lib/server/grantsShimStore';

const VALID_SCOPES: ReadonlyArray<GrantScope> = [
  'once',
  'always-for-room',
  'always-for-agent'
];

type Body = {
  decisionScope?: unknown;
  pidChain?: unknown;
};

/**
 * Sec-iter1 Fix #1 (2026-05-30 enterprise security pass): caller-handle
 * resolution delegates to permissionCallerIdentity.ts which reads the
 * AUTHORITATIVE terminal_records.handle (1:1 with terminal_id, UNIQUE
 * across active rows per Fix #2). The prior implementation read
 * `memberships[0].handle` — that surface lets an attacker register a
 * terminal, get invited into ANY older room as the victim's handle,
 * then approve/deny the victim's pending requests. The new helper
 * fail-closes when the caller has no declared handle.
 */
function resolveCallerHandle(request: Request, rawBody: unknown): string {
  return resolveAuthoritativeCallerHandle(request, rawBody);
}

function requireApproverFor(
  callerHandle: string,
  targetKind: PermissionTargetKind,
  targetId: string,
  action: string,
  requesterHandle: string
): void {
  if (callerHandle === ADMIN_BEARER_HANDLE) return;
  if (targetKind === 'system') {
    throw error(403, buildPermissionDeniedPayload({
      action: 'permission_request.approve',
      target_kind: 'system',
      target_id: targetId,
      reason: 'not_org_admin' satisfies PermissionDeniedReason,
      grantee_handle: requesterHandle,
      approvers: [],
      message: 'System-scoped requests can only be approved with admin-bearer.'
    }));
  }
  const approvers = resolveApproversFor({ targetKind, targetId });
  if (approvers.some((a) => a.handle === callerHandle)) return;
  const reason: PermissionDeniedReason =
    targetKind === 'room' ? 'not_room_owner'
    : targetKind === 'org' ? 'not_org_admin'
    : 'no_grant';
  throw error(403, buildPermissionDeniedPayload({
    action: `permission_request.approve.${action}`,
    target_kind: targetKind,
    target_id: targetId,
    reason,
    grantee_handle: requesterHandle,
    approvers
  }));
}

export const POST: RequestHandler = async ({ request, params }) => {
  const requestId = params.requestId;
  if (!requestId || typeof requestId !== 'string') {
    throw error(400, 'requestId required in path');
  }
  let rawBody: Body;
  try {
    rawBody = (await request.json().catch(() => ({}))) as Body;
  } catch {
    rawBody = {} as Body;
  }
  let decisionScope: GrantScope | undefined;
  if (rawBody.decisionScope !== undefined) {
    if (
      typeof rawBody.decisionScope !== 'string' ||
      !VALID_SCOPES.includes(rawBody.decisionScope as GrantScope)
    ) {
      throw error(400, `decisionScope must be one of: ${VALID_SCOPES.join(', ')}`);
    }
    decisionScope = rawBody.decisionScope as GrantScope;
  }
  // Resolve caller BEFORE the existence check so 401 wins over 404 on
  // unauthenticated probes (do not leak which request IDs exist).
  const callerHandle = resolveCallerHandle(request, rawBody);

  const existing = getPermissionRequest(requestId);
  if (!existing) throw error(404, 'permission_request not found');
  if (existing.status !== 'pending') {
    throw error(409, `permission_request is ${existing.status}, cannot approve`);
  }

  requireApproverFor(
    callerHandle,
    existing.targetKind,
    existing.targetId,
    existing.action,
    existing.requesterHandle
  );

  const result = approveRequest({
    requestId,
    decidedByHandle: callerHandle,
    decisionScope
  });

  // Replay signal: ready iff the pending_action is now flagged
  // 'ready_for_replay'. ready=false means either no pending_action was
  // attached at request creation, or the pending_action expired before
  // approval landed.
  const ready = result.pendingAction?.replayStatus === 'ready_for_replay';
  return json({
    request: result.request,
    grant: result.grant,
    replay: {
      ready,
      status: result.pendingAction?.replayStatus ?? null,
      actionId: result.pendingAction?.actionId ?? null
    }
  });
};
