/**
 * POST /api/remote-ant/mappings/:mappingId/revoke
 * Auth: admin-bearer.
 * 200 { revoked: true } on success; 404 if mapping unknown OR already revoked.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { revokeMapping } from '$lib/server/remoteMappingStore';

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminAuth(request);
  const mappingId = params.mappingId ?? '';
  if (mappingId.length === 0) throw error(400, 'mappingId required');
  const ok = revokeMapping(mappingId);
  if (!ok) throw error(404, 'mapping not found or already revoked');
  return json({ revoked: true, mapping_id: mappingId });
};
