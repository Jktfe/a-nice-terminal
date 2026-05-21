/**
 * GET /api/remote-ant/mappings?roomId=R
 * Auth: admin-bearer.
 * Response: { mappings: [...] } — token bytes never returned.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { listActiveForRoom } from '$lib/server/remoteMappingStore';

export const GET: RequestHandler = async ({ request, url }) => {
  requireAdminAuth(request);
  const roomId = url.searchParams.get('roomId') ?? '';
  if (roomId.length === 0) throw error(400, 'roomId required');
  const mappings = listActiveForRoom(roomId).map((m) => ({
    id: m.id,
    room_id: m.room_id,
    remote_instance_label: m.remote_instance_label,
    direction: m.direction,
    lifetime_preset: m.lifetime_preset,
    expires_at_ms: m.expires_at_ms,
    created_at_ms: m.created_at_ms,
    last_seen_at_ms: m.last_seen_at_ms,
    admission_id: m.admission_id
  }));
  return json({ mappings });
};
