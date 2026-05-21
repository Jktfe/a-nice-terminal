/**
 * POST /api/remote-ant/bridge/messages — remote instance posts an inbound
 * cross-bridge event.
 *
 * Auth: Authorization: Bearer rbt_... bridge token. mapping_id is
 * server-resolved from the bearer per contract Q3 — no body field can
 * claim a different mapping. touchLastSeen fires AFTER auth resolves
 * (per polish A) so revoked mappings never bump.
 *
 * Body: { kind: string, payloadJson: string, replaySignature: string }
 *
 * Response 201: { event: { id, status, status_reason, ... } }
 *   status will be 'accepted' or 'quarantined' per contract Q5 (no
 *   'rejected' is ever stored — rejects are no-store 4xx).
 *
 * 401 unknown/revoked/expired bearer.
 * 400 missing/malformed body.
 * 413 payload over 64KB (per contract Q2 polish C).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveByBearer, touchLastSeen } from '$lib/server/remoteMappingStore';
import { appendEvent } from '$lib/server/remoteEventStore';

const PAYLOAD_BYTES_CAP = 64 * 1024;

export const POST: RequestHandler = async ({ request }) => {
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (supplied.length === 0 || !supplied.startsWith('rbt_')) {
    throw error(401, 'bridge bearer required');
  }
  const resolved = resolveByBearer(supplied);
  if (!resolved) throw error(401, 'bridge bearer invalid, expired, or revoked');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');
  const kind = (body as Record<string, unknown>).kind;
  const payloadJson = (body as Record<string, unknown>).payloadJson;
  const replaySig = (body as Record<string, unknown>).replaySignature;
  if (typeof kind !== 'string' || kind.length === 0) throw error(400, 'kind required');
  if (typeof payloadJson !== 'string') throw error(400, 'payloadJson required (string)');
  if (typeof replaySig !== 'string' || replaySig.length === 0) throw error(400, 'replaySignature required');
  if (Buffer.byteLength(payloadJson, 'utf8') > PAYLOAD_BYTES_CAP) {
    throw error(413, 'payloadJson exceeds 64KB limit');
  }

  const result = appendEvent({
    mappingId: resolved.mapping_id,
    direction: 'in',
    kind,
    payloadJson,
    replaySignature: replaySig
  });
  // Per T2 B2 fix: touchLastSeen fires AFTER appendEvent succeeds (any
  // status — both accepted and quarantined count as a successful inbound
  // bridge POST). Failed body validation / payload-too-big do NOT bump.
  touchLastSeen(resolved.mapping_id);
  return json({
    event: {
      id: result.event.id,
      mapping_id: result.event.mapping_id,
      status: result.event.status,
      status_reason: result.event.status_reason,
      created_at_ms: result.event.created_at_ms
    }
  }, { status: 201 });
};
