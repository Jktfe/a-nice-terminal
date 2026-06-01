/**
 * /api/orgs/[orgId]/admins/[handle] — F1 org-admin revoke substrate.
 *
 * - DELETE (admin-bearer) soft-revoke an active org-admin row.
 *           -> 204 on success
 *           -> 404 if no active row to revoke
 *
 * The revoker handle is taken from the `x-revoked-by` header (defaults
 * to '@system' if absent — substrate-level revoke from the license-
 * webhook side has no per-user actor).
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { revokeOrgAdmin, getOrg } from '$lib/server/orgsStore';

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

export const DELETE: RequestHandler = ({ request, params }) => {
  requireAdminBearer(request);
  const orgId = params.orgId;
  const handle = params.handle;
  if (!orgId || !handle) throw error(400, 'orgId + handle required');
  if (!getOrg(orgId)) throw error(404, `Org ${orgId} not found`);
  const revokedBy = request.headers.get('x-revoked-by') ?? '@system';
  const decoded = decodeURIComponent(handle);
  const revoked = revokeOrgAdmin({ orgId, handle: decoded, revokedBy });
  if (!revoked) throw error(404, `No active admin row for ${decoded} on org ${orgId}`);
  return new Response(null, { status: 204 });
};
