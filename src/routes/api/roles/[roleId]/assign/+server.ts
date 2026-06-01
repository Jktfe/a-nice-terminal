/**
 * /api/roles/[roleId]/assign — M6.1 role assignment endpoint.
 *
 *   POST { identityHandle, scopeKind, scopeId }
 *     -> 201 { assignment }
 *
 * Auth model:
 *   - admin-bearer always permitted.
 *   - Org-admin delegation hook (TODO M6.2): when scopeKind='org' and the
 *     caller is an org-admin for the same scopeId AND the assignee belongs
 *     to that org, the call should succeed without admin-bearer. That
 *     requires the org membership primitive (M5 territory). For M6.1 we
 *     stop at admin-bearer + a fail-closed 401 so the contract is safe by
 *     default; M6.2 adds the org-admin lane.
 *
 * Audit:
 *   The store's `assignRole` calls `recordAuditEvent` which best-effort
 *   writes to `audit_events` when present. The M7.1 audit store wrapper
 *   will replace that path; until then the call is a graceful no-op when
 *   the table or schema is absent.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, ADMIN_BEARER_HANDLE } from '$lib/server/chatRoomAuthGate';
import {
  getRole,
  assignRole,
  seedRolesRegistry
} from '$lib/server/rolesRegistryStore';

const VALID_SCOPE_KINDS = ['global', 'org', 'room', 'session'] as const;

function requireAdmin(request: Request): void {
  if (!tryAdminBearer(request)) {
    throw error(401, 'admin-bearer required');
  }
}

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdmin(request);
  seedRolesRegistry();
  const roleId = params.roleId ?? '';
  if (!getRole(roleId)) throw error(404, `role '${roleId}' not found`);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'JSON body required');
  }

  const identityHandle = body.identityHandle;
  const scopeKind = body.scopeKind;
  const scopeId = body.scopeId;

  if (typeof identityHandle !== 'string' || identityHandle.trim().length === 0) {
    throw error(400, 'identityHandle (string) required');
  }
  if (
    typeof scopeKind !== 'string' ||
    !(VALID_SCOPE_KINDS as ReadonlyArray<string>).includes(scopeKind)
  ) {
    throw error(
      400,
      `scopeKind must be one of: ${VALID_SCOPE_KINDS.join(', ')}`
    );
  }
  // scopeId is required for non-global scopes; admin-only convention says
  // 'global' assignments leave scopeId NULL.
  let resolvedScopeId: string | null = null;
  if (scopeKind === 'global') {
    if (scopeId !== undefined && scopeId !== null && scopeId !== '') {
      // Permit but ignore — global assignments never bind to a target id.
      resolvedScopeId = null;
    }
  } else {
    if (typeof scopeId !== 'string' || scopeId.trim().length === 0) {
      throw error(400, 'scopeId (string) required for non-global scopes');
    }
    resolvedScopeId = scopeId.trim();
  }

  const assignment = assignRole({
    roleId,
    identityHandle: identityHandle.trim(),
    scopeKind,
    scopeId: resolvedScopeId,
    assignedByHandle: ADMIN_BEARER_HANDLE
  });

  return json({ assignment }, { status: 201 });
};
