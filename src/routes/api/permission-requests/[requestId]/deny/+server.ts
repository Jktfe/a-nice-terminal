/**
 * POST /api/permission-requests/:requestId/deny — Stage B substrate
 * (plan milestone p3-stage-b-permission-requests of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Body: { reason?, pidChain? }
 *
 * Auth gate matches the approve endpoint exactly — only a valid approver
 * (or admin-bearer) can deny. Flips request.status='denied' + pending_
 * action.replay_status='denied' so the CLI poller bails out cleanly.
 *
 * Returns 200 { request }.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  denyRequest,
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

type Body = {
  reason?: unknown;
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
      action: 'permission_request.deny',
      target_kind: 'system',
      target_id: targetId,
      reason: 'not_org_admin' satisfies PermissionDeniedReason,
      grantee_handle: requesterHandle,
      approvers: [],
      message: 'System-scoped requests can only be denied with admin-bearer.'
    }));
  }
  const approvers = resolveApproversFor({ targetKind, targetId });
  if (approvers.some((a) => a.handle === callerHandle)) return;
  const reason: PermissionDeniedReason =
    targetKind === 'room' ? 'not_room_owner'
    : targetKind === 'org' ? 'not_org_admin'
    : 'no_grant';
  throw error(403, buildPermissionDeniedPayload({
    action: `permission_request.deny.${action}`,
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
  let reason: string | undefined;
  if (rawBody.reason !== undefined) {
    if (typeof rawBody.reason !== 'string') throw error(400, 'reason must be a string');
    reason = rawBody.reason;
  }
  const callerHandle = resolveCallerHandle(request, rawBody);
  const existing = getPermissionRequest(requestId);
  if (!existing) throw error(404, 'permission_request not found');
  if (existing.status !== 'pending') {
    throw error(409, `permission_request is ${existing.status}, cannot deny`);
  }
  requireApproverFor(
    callerHandle,
    existing.targetKind,
    existing.targetId,
    existing.action,
    existing.requesterHandle
  );
  const updated = denyRequest({ requestId, decidedByHandle: callerHandle, reason });
  return json({ request: updated });
};
