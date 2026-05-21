/**
 * GET /api/remote-ant/quarantine[?mappingId=M]
 * Auth: admin-bearer.
 * Returns quarantined events newest-first; per-mapping when ?mappingId=
 * is set, otherwise all quarantined events across mappings.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { listQuarantineForMapping, listQuarantineAll } from '$lib/server/remoteEventStore';

export const GET: RequestHandler = async ({ request, url }) => {
  requireAdminAuth(request);
  const mappingId = url.searchParams.get('mappingId') ?? '';
  const events = mappingId.length > 0
    ? listQuarantineForMapping(mappingId)
    : listQuarantineAll();
  return json({
    events: events.map((e) => ({
      id: e.id,
      mapping_id: e.mapping_id,
      direction: e.direction,
      kind: e.kind,
      status: e.status,
      status_reason: e.status_reason,
      created_at_ms: e.created_at_ms,
      ack_at_ms: e.ack_at_ms
    }))
  });
};

import { error } from '@sveltejs/kit';
import { markAck } from '$lib/server/remoteEventStore';

/**
 * POST /api/remote-ant/quarantine — operator acks a quarantined event.
 * Body: { eventId: string }
 */
export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  let body: unknown;
  try { body = await request.json(); } catch { throw error(400, 'invalid JSON body'); }
  const eventId = (body as Record<string, unknown> | null)?.eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) throw error(400, 'eventId required');
  const ok = markAck(eventId);
  if (!ok) throw error(404, 'event not found or already acked');
  return json({ acked: true, event_id: eventId });
};
