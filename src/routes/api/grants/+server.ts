/**
 * /api/grants — Stage A grants_shim endpoint backing the `ant grant`
 * CLI verb (plan milestone p3-stage-a-grant-cli of
 * ant-substrate-v0.2-2026-05-29).
 *
 *   POST /api/grants
 *     Body: { granteeHandle, action, targetKind, targetId,
 *             scope?: 'once' | 'always-for-room' | 'always-for-agent',
 *             pidChain?: number[] }
 *     -> 201 { grant } on success; appends a row to grants_shim.
 *     -> 401 when caller identity cannot be resolved.
 *     -> 400 on malformed body.
 *
 *   DELETE /api/grants
 *     Body: { granteeHandle, action, targetKind, targetId, pidChain? }
 *     -> 200 { revokedCount } — number of active rows soft-revoked.
 *     -> 401 when caller identity cannot be resolved.
 *     -> 400 on malformed body.
 *
 * Auth model (Stage A — hardened 2026-05-29 after security review):
 * Two gates layered:
 *   1. Authentication — admin-bearer OR pidChain → terminal lookup; 401
 *      when neither resolves.
 *   2. Authorization — admin-bearer bypasses; otherwise the resolved
 *      caller handle must appear in resolveApproversFor({targetKind,
 *      targetId}). Room owner can grant on their own room, plan owner
 *      on their own plan, etc. 403 with structured permission_denied
 *      payload otherwise. System-scoped grants are admin-bearer only.
 *
 * Stage B will replace the approver gate with the full permission_requests
 * + signed-nonce attestation flow (Part 4 trust_pubkey work); the gate
 * shape stays the same so existing tests survive the cut-over.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  grantPermission,
  revokePermission,
  type GrantScope
} from '$lib/server/grantsShimStore';
import {
  buildPermissionDeniedPayload,
  type PermissionDeniedReason,
  type PermissionTargetKind
} from '$lib/server/permissionDeniedPayload';
import { resolveApproversFor } from '$lib/server/permissionApproverResolver';
import { tryAdminBearer, ADMIN_BEARER_HANDLE } from '$lib/server/chatRoomAuthGate';
import { parsePidChainFromBody } from '$lib/server/identityGate';
import { lookupTerminalByPidChain } from '$lib/server/terminalsStore';
import { listMembershipsForTerminal } from '$lib/server/roomMembershipsStore';

/**
 * Sec-iter2 Fix #3 (2026-05-30): typed caller identity. The pre-iter2
 * grants endpoint used a bare string + `callerHandle === ADMIN_BEARER_HANDLE`
 * — that string-equality made the entire admin short-circuit spoofable
 * by ANY surface that could land the literal '@admin' into a handle the
 * gate then trusts. The new shape derives `isAdminBearer` SOLELY from a
 * proven admin-bearer token; the handle is purely display/audit.
 *
 * NOTE: unlike the permission-requests endpoints which now read the
 * authoritative terminal_records.handle (sec-iter1 Fix #1), this
 * endpoint still derives the audit handle from
 * `listMembershipsForTerminal(...)[0]` for back-compat with the Stage A
 * grant attribution model. The authoritative-handle migration here is
 * tracked separately; sec-iter2 Fix #3 only removes the string-eq
 * admin-spoof surface.
 */
type GrantsCallerIdentity = {
  handle: string;
  isAdminBearer: boolean;
};

const VALID_TARGET_KINDS: ReadonlyArray<PermissionTargetKind> = [
  'room',
  'plan',
  'task',
  'org',
  'system'
];

const VALID_SCOPES: ReadonlyArray<GrantScope> = [
  'once',
  'always-for-room',
  'always-for-agent'
];

type GrantBody = {
  granteeHandle?: unknown;
  action?: unknown;
  targetKind?: unknown;
  targetId?: unknown;
  scope?: unknown;
  pidChain?: unknown;
};

function resolveCallerIdentity(request: Request, rawBody: unknown): GrantsCallerIdentity {
  // Sec-iter2 Fix #3 (2026-05-30): admin-bearer flag derives SOLELY from
  // the constant-time token check. The returned `handle` is the audit
  // display value (ADMIN_BEARER_HANDLE for admin-bearer callers); the
  // approver gate below uses `isAdminBearer` for authority, never the
  // string.
  if (tryAdminBearer(request)) {
    return { handle: ADMIN_BEARER_HANDLE, isAdminBearer: true };
  }
  const pidChain = parsePidChainFromBody(rawBody);
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) {
    throw error(401, 'Authentication required.');
  }
  // Derive a representative handle for granted_by_handle. Prefer the
  // first membership row tied to this terminal — the grant action is
  // attributed to the human/agent who owns the registered terminal
  // (Stage A approximation; Stage B threads explicit identity).
  const memberships = listMembershipsForTerminal(terminal.id);
  if (memberships.length > 0) {
    return { handle: memberships[0].handle, isAdminBearer: false };
  }
  // Fall back to the terminal name so the audit trail at least
  // identifies WHICH terminal issued the grant.
  return { handle: `@${terminal.name}`, isAdminBearer: false };
}

function validateBody(body: GrantBody): {
  granteeHandle: string;
  action: string;
  targetKind: PermissionTargetKind;
  targetId: string;
  scope: GrantScope;
} {
  const { granteeHandle, action, targetKind, targetId, scope } = body;
  if (typeof granteeHandle !== 'string' || granteeHandle.trim().length === 0) {
    throw error(400, 'granteeHandle (string) required');
  }
  if (typeof action !== 'string' || action.trim().length === 0) {
    throw error(400, 'action (string) required');
  }
  if (
    typeof targetKind !== 'string' ||
    !VALID_TARGET_KINDS.includes(targetKind as PermissionTargetKind)
  ) {
    throw error(
      400,
      `targetKind must be one of: ${VALID_TARGET_KINDS.join(', ')}`
    );
  }
  if (typeof targetId !== 'string' || targetId.trim().length === 0) {
    throw error(400, 'targetId (string) required');
  }
  let resolvedScope: GrantScope = 'once';
  if (scope !== undefined) {
    if (typeof scope !== 'string' || !VALID_SCOPES.includes(scope as GrantScope)) {
      throw error(400, `scope must be one of: ${VALID_SCOPES.join(', ')}`);
    }
    resolvedScope = scope as GrantScope;
  }
  return {
    granteeHandle: granteeHandle.trim(),
    action: action.trim(),
    targetKind: targetKind as PermissionTargetKind,
    targetId: targetId.trim(),
    scope: resolvedScope
  };
}

/**
 * Approver gate (Stage A — security fix 2026-05-29):
 *
 * Authentication alone is insufficient — any authenticated caller could
 * otherwise grant any permission on any target (HIGH privilege escalation
 * flagged by security review on initial Stage A ship). The fix: after
 * resolving the caller, verify they're in the approver set for the target
 * (room owner / plan owner / task assignee+owner / org admin / admin-bearer
 * for system). Reuses resolveApproversFor() — same primitive that builds
 * the 403 payload, so the contract is symmetric: the handles we surface
 * to a denied caller are the same handles we accept as approvers here.
 */
function requireApproverForTarget(
  caller: GrantsCallerIdentity,
  granteeHandle: string,
  action: string,
  targetKind: PermissionTargetKind,
  targetId: string
): void {
  // Sec-iter2 Fix #3: admin-bearer short-circuit reads the typed
  // discriminator, never a string-eq to the admin sentinel handle.
  // Admin-bearer bypasses the approver check (matches the rest of the
  // substrate's emergency-recovery model — admin-bearer is the break-
  // glass primitive).
  if (caller.isAdminBearer) return;

  // System grants are admin-bearer only by design; non-admin callers
  // hit this branch via resolveApproversFor returning [].
  if (targetKind === 'system') {
    throw error(403, buildPermissionDeniedPayload({
      action: 'grant.issue',
      target_kind: 'system',
      target_id: targetId,
      reason: 'not_org_admin' satisfies PermissionDeniedReason,
      grantee_handle: granteeHandle,
      approvers: [],
      message: 'System-scoped grants require admin-bearer.'
    }));
  }

  const approvers = resolveApproversFor({ targetKind, targetId });
  const isApprover = approvers.some((a) => a.handle === caller.handle);
  if (isApprover) return;

  // Pick the most-fitting reason for the rejection so the CLI renderer
  // surfaces a useful hint to the caller (who can in turn ask the right
  // person to grant THEM approver rights, recursively).
  const reason: PermissionDeniedReason =
    targetKind === 'room' ? 'not_room_owner'
    : targetKind === 'org' ? 'not_org_admin'
    : 'no_grant';

  throw error(403, buildPermissionDeniedPayload({
    action: `grant.issue.${action}`,
    target_kind: targetKind,
    target_id: targetId,
    reason,
    grantee_handle: granteeHandle,
    approvers
  }));
}

export const POST: RequestHandler = async ({ request }) => {
  let rawBody: GrantBody;
  try {
    rawBody = (await request.json()) as GrantBody;
  } catch {
    throw error(400, 'JSON body required');
  }
  const validated = validateBody(rawBody);
  const caller = resolveCallerIdentity(request, rawBody);
  requireApproverForTarget(
    caller,
    validated.granteeHandle,
    validated.action,
    validated.targetKind,
    validated.targetId
  );
  const grant = grantPermission({
    granteeHandle: validated.granteeHandle,
    action: validated.action,
    targetKind: validated.targetKind,
    targetId: validated.targetId,
    grantedByHandle: caller.handle,
    scope: validated.scope
  });
  return json({ grant }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request }) => {
  // SvelteKit gives DELETE a request object too; expect JSON body for
  // parity with POST so the CLI single-flow works.
  let rawBody: GrantBody;
  try {
    rawBody = (await request.json()) as GrantBody;
  } catch {
    throw error(400, 'JSON body required');
  }
  const validated = validateBody(rawBody);
  const caller = resolveCallerIdentity(request, rawBody);
  // Same approver gate as POST — only an authorised approver (or admin-
  // bearer) can revoke a grant on the target.
  requireApproverForTarget(
    caller,
    validated.granteeHandle,
    validated.action,
    validated.targetKind,
    validated.targetId
  );
  const revokedCount = revokePermission({
    granteeHandle: validated.granteeHandle,
    action: validated.action,
    targetKind: validated.targetKind,
    targetId: validated.targetId
  });
  return json({ revokedCount });
};
