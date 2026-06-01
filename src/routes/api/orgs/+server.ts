/**
 * /api/orgs — F1 license-time namespace provisioning substrate.
 *
 * - POST  (admin-bearer) register a new org. Body: { id, display_name,
 *           namespace_prefix, tier?, created_by } -> 201 { org }.
 * - GET   (open read) list all orgs.
 *
 * Auth: POST gates on admin-bearer for now. The license-purchase flow
 * on antonline.dev will call this with the admin-bearer once the
 * server-side webhook lands; until then admin-bearer is the substrate
 * boundary.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createOrg, listOrgs, type OrgTier } from '$lib/server/orgsStore';

const VALID_TIERS = new Set<OrgTier>(['oss', 'premium', 'enterprise']);

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

export const GET: RequestHandler = () => {
  return json({ orgs: listOrgs() });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdminBearer(request);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }

  const id = body.id;
  const displayName = body.display_name;
  const namespacePrefix = body.namespace_prefix;
  const createdBy = body.created_by;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw error(400, 'id (string) required');
  }
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw error(400, 'display_name (string) required');
  }
  if (typeof namespacePrefix !== 'string' || namespacePrefix.trim().length === 0) {
    throw error(400, 'namespace_prefix (string) required');
  }
  if (typeof createdBy !== 'string' || createdBy.trim().length === 0) {
    throw error(400, 'created_by (string) required');
  }

  let tier: OrgTier = 'oss';
  if (body.tier !== undefined) {
    if (typeof body.tier !== 'string' || !VALID_TIERS.has(body.tier as OrgTier)) {
      throw error(400, `tier must be one of: ${[...VALID_TIERS].join(', ')}`);
    }
    tier = body.tier as OrgTier;
  }

  try {
    const org = createOrg({
      id: id.trim(),
      displayName: displayName.trim(),
      namespacePrefix: namespacePrefix.trim(),
      tier,
      createdBy: createdBy.trim()
    });
    return json({ org }, { status: 201 });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw error(409, msg);
  }
};
