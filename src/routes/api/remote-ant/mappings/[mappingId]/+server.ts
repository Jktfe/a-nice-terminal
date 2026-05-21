/**
 * GET /api/remote-ant/mappings/:mappingId — single mapping detail.
 * Auth: admin-bearer. Token bytes NOT returned.
 * 404 if no mapping with that id.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { findById } from '$lib/server/remoteMappingStore';

export const GET: RequestHandler = async ({ request, params }) => {
  requireAdminAuth(request);
  const mappingId = params.mappingId ?? '';
  if (mappingId.length === 0) throw error(400, 'mappingId required');
  const m = findById(mappingId);
  if (!m) throw error(404, 'mapping not found');
  return json({
    mapping: {
      id: m.id,
      room_id: m.room_id,
      remote_instance_label: m.remote_instance_label,
      direction: m.direction,
      lifetime_preset: m.lifetime_preset,
      expires_at_ms: m.expires_at_ms,
      created_at_ms: m.created_at_ms,
      last_seen_at_ms: m.last_seen_at_ms,
      revoked_at_ms: m.revoked_at_ms,
      admission_id: m.admission_id
    }
  });
};
