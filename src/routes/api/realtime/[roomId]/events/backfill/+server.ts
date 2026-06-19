/**
 * GET /api/realtime/[roomId]/events/backfill?since_seq=N
 *
 * v0 of the SSE consumer contract (docs/contracts/sse-consumer-contract-v0.md).
 * Events are not persisted in v0; this endpoint exists so consumers have
 * a contract surface to query on reconnect. Returns 410 Gone with the
 * current seq so the caller knows the gap is unrecoverable and should
 * resume from the present.
 *
 * v1 (future): persist a per-room ring buffer (last ~1000 events) and
 * return the events with seq > since_seq.
 *
 * Auth: same `requireChatRoomReadAccess` as the SSE endpoint
 * (guard-before-action — the read-gate check runs before any work).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { currentSeqForRoom } from '$lib/server/eventBroadcast';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = async ({ params, request, url }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'roomId required.');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'room not found');
  await requireChatRoomReadAccess(request, room);

  const sinceSeqRaw = url.searchParams.get('since_seq');
  const sinceSeq = sinceSeqRaw !== null ? Number.parseInt(sinceSeqRaw, 10) : NaN;
  if (sinceSeqRaw !== null && (!Number.isFinite(sinceSeq) || sinceSeq < 0)) {
    throw error(400, 'since_seq must be a non-negative integer when supplied.');
  }

  const latestSeq = currentSeqForRoom(roomId);

  // v0: events not persisted. Honest 410 if the caller asked for any
  // historical seq; honest 200 with empty events array if the caller's
  // since_seq is already at-or-past the latest (no gap).
  if (sinceSeqRaw === null || sinceSeq >= latestSeq) {
    return json({ events: [], latest_seq: latestSeq, gap: false });
  }

  throw error(410, {
    message: 'Backfill not available (events not persisted in v0). Resume from latest_seq.',
    // Keep the recovery hint structured in the JSON error body so consumers
    // can recover without string-parsing the message.
    latest_seq: latestSeq
  } as unknown as { message: string });
};
