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
import {
  resolveAuthoritativeCallerIdentity,
  type AuthoritativeCallerIdentity
} from '$lib/server/permissionCallerIdentity';

/**
 * Sec-iter6 Fix #2 (2026-05-30): grants caller-identity migrated to
 * `resolveAuthoritativeCallerIdentity` from `permissionCallerIdentity.ts`.
 * Closes the last piece of the iter-5 HIGH exploit chain:
 *
 * Pre-iter6 this endpoint used a local `resolveCallerIdentity` that
 * derived the caller's handle from `listMembershipsForTerminal(...)[0]`
 * — the SAME attacker-controllable surface that sec-iter1 Fix #1 closed
 * for `/api/permission-requests`. An attacker who landed a `(roomX,
 * @victim)` membership row on their own terminal (the iter-5 chain step
 * that Fix #1 + Fix #3 now block at the wire AND structurally) could
 * then call `/api/grants` and have caller-identity resolve to `@victim`,
 * passing the approver-set gate for any target where `@victim` was an
 * approver.
 *
 * Iter-2 Fix #3 noted this gap explicitly: "the authoritative-handle
 * migration here is tracked separately; sec-iter2 Fix #3 only removes
 * the string-eq admin-spoof surface." Iter-6 Fix #2 closes the tracked
 * gap.
 *
 * The local `GrantsCallerIdentity` type is removed in favour of the
 * typed `AuthoritativeCallerIdentity` discriminator (which carries the
 * same `{ handle, isAdminBearer }` shape). Authority decisions read
 * `caller.isAdminBearer`; the approver-set membership check reads
 * `caller.handle` (now from UNIQUE-indexed terminal_records.handle, not
 * the attacker-controllable memberships[0]).
 */

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

/**
 * Sec-iter6 Fix #2 (2026-05-30): caller-identity now delegates to the
 * shared `resolveAuthoritativeCallerIdentity` helper. Behaviour change
 * from the old local `resolveCallerIdentity`:
 *
 *   - admin-bearer: SAME (typed `isAdminBearer: true`, handle is
 *     `ADMIN_BEARER_HANDLE` audit display).
 *   - non-admin: handle now comes from `terminal_records.handle` (the
 *     AUTHORITATIVE binding sec-iter1 Fix #2 UNIQUE-indexed) instead of
 *     `memberships[0].handle` (the attacker-controllable per-room
 *     binding). Terminals with NULL/empty handle 401 with the same
 *     "run ant register --handle @<your-handle>" recovery hint as
 *     /api/permission-requests endpoints.
 *
 * Fail-closed: the old fallback that returned `@<terminal.name>` for
 * terminals with no membership row is removed — that path was the
 * fallback the old derivation used, but it was also a fallback the
 * grant attribution audit trail wrote without verifying the terminal
 * was actually authorised. Forcing explicit handle registration before
 * issuing grants is the correct contract.
 */
function resolveCallerIdentity(request: Request, rawBody: unknown): AuthoritativeCallerIdentity {
  return resolveAuthoritativeCallerIdentity(request, rawBody);
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
  caller: AuthoritativeCallerIdentity,
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
