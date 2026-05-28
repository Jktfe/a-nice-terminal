/**
 * /api/orgs/[orgId]/admins — F1 org-admin assignment substrate.
 *
 * - POST (admin-bearer) assign org-admin. Body: { handle, assigned_by }
 *          -> 201 { admin }. Idempotent on (orgId, handle) for active rows.
 * - GET  (open read) list active org-admins for the org.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assignOrgAdmin, listOrgAdmins, getOrg } from '$lib/server/orgsStore';

function requireAdminBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw error(401, 'Authorization: Bearer <admin-token> required');
  }
  const adminToken = process.env.ANT_ADMIN_BEARER;
  if (!adminToken || auth.slice(7) !== adminToken) {
    throw error(403, 'Admin bearer required');
  }
}

export const GET: RequestHandler = ({ params }) => {
  const orgId = params.orgId;
  if (!orgId) throw error(400, 'orgId required');
  if (!getOrg(orgId)) throw error(404, `Org ${orgId} not found`);
  return json({ admins: listOrgAdmins(orgId) });
};

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminBearer(request);
  const orgId = params.orgId;
  if (!orgId) throw error(400, 'orgId required');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }

  const handle = body.handle;
  const assignedBy = body.assigned_by;
  if (typeof handle !== 'string' || handle.trim().length === 0) {
    throw error(400, 'handle (string) required');
  }
  if (typeof assignedBy !== 'string' || assignedBy.trim().length === 0) {
    throw error(400, 'assigned_by (string) required');
  }

  try {
    const admin = assignOrgAdmin({
      orgId,
      handle: handle.trim(),
      assignedBy: assignedBy.trim()
    });
    return json({ admin }, { status: 201 });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg.includes('not found')) throw error(404, msg);
    throw error(400, msg);
  }
};
