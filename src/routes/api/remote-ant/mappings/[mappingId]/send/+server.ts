/**
 * POST /api/remote-ant/mappings/:mappingId/send — local operator queues
 * an OUT-direction event for delivery to the remote bridge.
 *
 * Per contract Q7 ant remote-room send + T2.5 missing-route patch.
 *
 * Auth: admin-bearer (ANT_ADMIN_TOKEN). NOT bridge bearer — this is the
 * LOCAL operator pushing OUTBOUND, distinct from bridge/messages which
 * is the REMOTE INSTANCE pushing INBOUND.
 *
 * Body: { kind: string, payloadJson: string, replaySignature?: string }
 *   replaySignature optional — auto-generated if absent (out-direction
 *   events from the local side rarely collide).
 *
 * 404 if mapping is unknown OR revoked OR expired.
 * 413 if payloadJson > 64KB.
 * 400 missing kind / payloadJson.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { findById } from '$lib/server/remoteMappingStore';
import { appendEvent } from '$lib/server/remoteEventStore';
import { mintTokenSecret } from '$lib/server/chatInviteStore';

const PAYLOAD_BYTES_CAP = 64 * 1024;

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminAuth(request);
  const mappingId = params.mappingId ?? '';
  if (mappingId.length === 0) throw error(400, 'mappingId required');
  const mapping = findById(mappingId);
  if (!mapping || mapping.revoked_at_ms !== null) throw error(404, 'mapping not found or revoked');
  const now = Date.now();
  if (mapping.expires_at_ms !== null && now > mapping.expires_at_ms) {
    throw error(404, 'mapping not found or revoked');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');
  const kind = (body as Record<string, unknown>).kind;
  const payloadJson = (body as Record<string, unknown>).payloadJson;
  const replaySigRaw = (body as Record<string, unknown>).replaySignature;
  if (typeof kind !== 'string' || kind.length === 0) throw error(400, 'kind required');
  if (typeof payloadJson !== 'string') throw error(400, 'payloadJson required (string)');
  if (Buffer.byteLength(payloadJson, 'utf8') > PAYLOAD_BYTES_CAP) {
    throw error(413, 'payloadJson exceeds 64KB limit');
  }
  const replaySignature = typeof replaySigRaw === 'string' && replaySigRaw.length > 0
    ? replaySigRaw
    : `out-${mintTokenSecret().slice(0, 12)}`;

  const result = appendEvent({
    mappingId, direction: 'out', kind, payloadJson, replaySignature
  });
  return json({
    event: {
      id: result.event.id,
      mapping_id: result.event.mapping_id,
      direction: result.event.direction,
      status: result.event.status,
      status_reason: result.event.status_reason,
      delivery_state: result.event.delivery_state,
      created_at_ms: result.event.created_at_ms
    }
  }, { status: 201 });
};
