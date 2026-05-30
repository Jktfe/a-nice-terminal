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
import { resolveAuthoritativeCallerIdentity } from '$lib/server/permissionCallerIdentity';
import type { AuthoritativeCallerIdentity } from '$lib/server/permissionCallerIdentity';
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
 * Sec-iter1 Fix #1 (2026-05-30): delegate caller-handle resolution to
 * permissionCallerIdentity.ts (terminal_records.handle, UNIQUE across
 * active rows per sec-iter1 Fix #2). Fail-closed when the caller has
 * no declared handle.
 *
 * Sec-iter2 Fix #3 (2026-05-30): the helper now returns the typed
 * AuthoritativeCallerIdentity discriminated by `isAdminBearer`. The
 * approver gate below reads `isAdminBearer` rather than string-comparing
 * the handle to `ADMIN_BEARER_HANDLE` — that string-eq is the iter2
 * bypass surface (any code path that lands the literal '@admin' into
 * terminal_records.handle wins admin via the gate). The new shape makes
 * admin-grade authority depend SOLELY on a proven admin-bearer token.
 */
function resolveCallerIdentity(request: Request, rawBody: unknown): AuthoritativeCallerIdentity {
  return resolveAuthoritativeCallerIdentity(request, rawBody);
}

function requireApproverFor(
  caller: AuthoritativeCallerIdentity,
  targetKind: PermissionTargetKind,
  targetId: string,
  action: string,
  requesterHandle: string
): void {
  // Sec-iter2 Fix #3: admin short-circuit reads the typed discriminator,
  // never the handle string. No string-eq to ADMIN_BEARER_HANDLE here.
  if (caller.isAdminBearer) return;
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
  if (approvers.some((a) => a.handle === caller.handle)) return;
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
  const caller = resolveCallerIdentity(request, rawBody);

  const existing = getPermissionRequest(requestId);
  if (!existing) throw error(404, 'permission_request not found');
  if (existing.status !== 'pending') {
    throw error(409, `permission_request is ${existing.status}, cannot approve`);
  }

  requireApproverFor(
    caller,
    existing.targetKind,
    existing.targetId,
    existing.action,
    existing.requesterHandle
  );

  const result = approveRequest({
    requestId,
    decidedByHandle: caller.handle,
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
