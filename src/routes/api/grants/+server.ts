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
 * Auth model (Stage A): admin-bearer OR pidChain that resolves to any
 * registered terminal. Stage B will add an approver gate that checks
 * the caller has owner / org_admin rights on the target. For Stage A
 * we trust the CLI surface — the `ant grant` UX is for the room owner
 * to delegate manually, not a programmatic surface yet.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  grantPermission,
  revokePermission,
  type GrantScope
} from '$lib/server/grantsShimStore';
import type { PermissionTargetKind } from '$lib/server/permissionDeniedPayload';
import { tryAdminBearer, ADMIN_BEARER_HANDLE } from '$lib/server/chatRoomAuthGate';
import { parsePidChainFromBody } from '$lib/server/identityGate';
import { lookupTerminalByPidChain } from '$lib/server/terminalsStore';
import { listMembershipsForTerminal } from '$lib/server/roomMembershipsStore';

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

function resolveCallerHandle(request: Request, rawBody: unknown): string {
  if (tryAdminBearer(request)) {
    return ADMIN_BEARER_HANDLE;
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
  if (memberships.length > 0) return memberships[0].handle;
  // Fall back to the terminal name so the audit trail at least
  // identifies WHICH terminal issued the grant.
  return `@${terminal.name}`;
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

export const POST: RequestHandler = async ({ request }) => {
  let rawBody: GrantBody;
  try {
    rawBody = (await request.json()) as GrantBody;
  } catch {
    throw error(400, 'JSON body required');
  }
  const validated = validateBody(rawBody);
  const grantedByHandle = resolveCallerHandle(request, rawBody);
  const grant = grantPermission({
    granteeHandle: validated.granteeHandle,
    action: validated.action,
    targetKind: validated.targetKind,
    targetId: validated.targetId,
    grantedByHandle,
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
  // Authentication check (same as POST). Throws 401 on no caller.
  resolveCallerHandle(request, rawBody);
  const revokedCount = revokePermission({
    granteeHandle: validated.granteeHandle,
    action: validated.action,
    targetKind: validated.targetKind,
    targetId: validated.targetId
  });
  return json({ revokedCount });
};
