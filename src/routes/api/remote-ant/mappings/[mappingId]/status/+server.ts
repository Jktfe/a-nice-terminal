/**
 * GET /api/remote-ant/mappings/:mappingId/status — M4 v2 count surface
 * lifting the v1 narrow PATH A deferral that explicitly said "counts by
 * delivery_state are V2 — see chat_remote_events.status column, future
 * GET /api/remote-ant/mappings/:id/status route".
 *
 * Returns the same mapping detail as GET /mappings/:id PLUS counts
 * grouped by status (accepted/quarantined) and delivery_state
 * (delivered/pending/failed). Missing categories zero-fill so consumers
 * can render without null-checks.
 *
 * Auth: admin-bearer. Token bytes never returned.
 * 404 unknown OR revoked mapping. 400 missing mappingId.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { findById } from '$lib/server/remoteMappingStore';
import { countsByMappingId } from '$lib/server/remoteEventStore';

export const GET: RequestHandler = async ({ request, params }) => {
  requireAdminAuth(request);
  const mappingId = params.mappingId ?? '';
  if (mappingId.length === 0) throw error(400, 'mappingId required');
  const mapping = findById(mappingId);
  if (!mapping || mapping.revoked_at_ms !== null) throw error(404, 'mapping not found or revoked');
  return json({
    mapping: {
      id: mapping.id,
      room_id: mapping.room_id,
      remote_instance_label: mapping.remote_instance_label,
      direction: mapping.direction,
      lifetime_preset: mapping.lifetime_preset,
      expires_at_ms: mapping.expires_at_ms,
      created_at_ms: mapping.created_at_ms,
      last_seen_at_ms: mapping.last_seen_at_ms,
      admission_id: mapping.admission_id
    },
    counts: countsByMappingId(mappingId)
  });
};
