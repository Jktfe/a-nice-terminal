/**
 * /api/roles/[roleId] — single-role endpoint of the M6.1 RBAC registry.
 *
 *   GET    — admin-bearer required, 404 when unknown.
 *   PATCH  — admin-bearer required, 403 when the role is seeded.
 *   DELETE — admin-bearer required, 403 when the role is seeded; cascades
 *            to role_capabilities + role_assignments via the ON DELETE
 *            CASCADE FKs declared in db.ts.
 *
 * Seeded-role guard lives in the store (`SEEDED_ROLE_PROTECTED`); the
 * API layer translates that throw to 403 so the contract is visible to
 * automation (procurement export, Control Plane UI). The PATCH body is
 * a partial: any of name / description / capabilities may be omitted.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import {
  getRole,
  updateRole,
  deleteRole,
  seedRolesRegistry,
  SEEDED_ROLE_PROTECTED,
  type RoleCapability
} from '$lib/server/rolesRegistryStore';

function requireAdmin(request: Request): void {
  if (!tryAdminBearer(request)) {
    throw error(401, 'admin-bearer required');
  }
}

function parseCapabilities(raw: unknown): RoleCapability[] {
  if (!Array.isArray(raw)) {
    throw error(400, 'capabilities must be an array of { capability, scope }');
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw error(400, `capabilities[${index}] must be an object`);
    }
    const cap = (entry as { capability?: unknown }).capability;
    const scope = (entry as { scope?: unknown }).scope;
    if (typeof cap !== 'string' || cap.trim().length === 0) {
      throw error(400, `capabilities[${index}].capability must be a non-empty string`);
    }
    if (typeof scope !== 'string' || scope.trim().length === 0) {
      throw error(400, `capabilities[${index}].scope must be a non-empty string`);
    }
    return { capability: cap.trim(), scope: scope.trim() };
  });
}

export const GET: RequestHandler = async ({ request, params }) => {
  requireAdmin(request);
  seedRolesRegistry();
  const roleId = params.roleId ?? '';
  const role = getRole(roleId);
  if (!role) throw error(404, `role '${roleId}' not found`);
  return json({ role });
};

export const PATCH: RequestHandler = async ({ request, params }) => {
  requireAdmin(request);
  seedRolesRegistry();
  const roleId = params.roleId ?? '';
  const existing = getRole(roleId);
  if (!existing) throw error(404, `role '${roleId}' not found`);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'JSON body required');
  }

  const patch: {
    name?: string;
    description?: string | null;
    capabilities?: RoleCapability[];
  } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      throw error(400, 'name must be a non-empty string when supplied');
    }
    patch.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      throw error(400, 'description must be a string or null');
    }
    patch.description = body.description as string | null;
  }
  if (body.capabilities !== undefined) {
    patch.capabilities = parseCapabilities(body.capabilities);
  }

  try {
    const role = updateRole(roleId, patch);
    return json({ role });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message === SEEDED_ROLE_PROTECTED) {
      throw error(403, `role '${roleId}' is seeded and cannot be modified`);
    }
    throw cause;
  }
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  requireAdmin(request);
  seedRolesRegistry();
  const roleId = params.roleId ?? '';
  try {
    deleteRole(roleId);
    return new Response(null, { status: 204 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message === SEEDED_ROLE_PROTECTED) {
      throw error(403, `role '${roleId}' is seeded and cannot be deleted`);
    }
    throw cause;
  }
};
