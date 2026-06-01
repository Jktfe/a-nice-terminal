/**
 * /api/roles — M6.1 RBAC role registry collection endpoint of the
 * antOS Enterprise Control Plane plan.
 *
 *   GET  /api/roles
 *     Admin-bearer required. Returns the full catalogue (seeded + custom).
 *     Used by the procurement export + the Control Plane UI's roles list.
 *
 *   POST /api/roles
 *     Admin-bearer required. Body:
 *       { roleId, name, description?, capabilities: [{capability, scope}] }
 *     Returns 201 { role } on success.
 *     400 when roleId collides with a seeded ID or an existing custom row,
 *     or when body fields are missing/invalid.
 *
 * Seeded roles are protected: the API refuses to overwrite them at the
 * 400 layer (POST) and the 403 layer (PATCH/DELETE). The check delegates
 * to the store's `ROLE_ID_CONFLICT` and `SEEDED_ROLE_PROTECTED` symbols.
 *
 * Auth model: admin-bearer only for this M6.1 slice. Org-admin delegation
 * lives on the assignment route (where the org-scope check has a target
 * to compare against). The Control Plane spec keeps the role catalogue
 * itself a substrate-admin surface until the M6.2 delegation work lands.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import {
  listRoles,
  createRole,
  seedRolesRegistry,
  ROLE_ID_CONFLICT,
  SEEDED_ROLE_IDS,
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

export const GET: RequestHandler = async ({ request }) => {
  requireAdmin(request);
  seedRolesRegistry();
  return json({ roles: listRoles() });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdmin(request);
  seedRolesRegistry();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'JSON body required');
  }
  const roleId = body.roleId;
  const name = body.name;
  const description = body.description;
  if (typeof roleId !== 'string' || roleId.trim().length === 0) {
    throw error(400, 'roleId (string) required');
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw error(400, 'name (string) required');
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw error(400, 'description must be a string when supplied');
  }
  if ((SEEDED_ROLE_IDS as ReadonlyArray<string>).includes(roleId.trim())) {
    throw error(400, `roleId '${roleId}' is reserved for a seeded role`);
  }
  const capabilities = parseCapabilities(body.capabilities);
  try {
    const role = createRole({
      roleId: roleId.trim(),
      name: name.trim(),
      description: typeof description === 'string' ? description : null,
      capabilities
    });
    return json({ role }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message === ROLE_ID_CONFLICT) {
      throw error(400, `roleId '${roleId}' already exists`);
    }
    throw cause;
  }
};
