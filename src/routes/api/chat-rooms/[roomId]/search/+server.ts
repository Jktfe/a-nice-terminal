/**
 * Search messages within ONE chat room.
 *
 *   GET /api/chat-rooms/:roomId/search?q=<query>[&limit=<n>]
 *     → 200 { matches: [{ id, postedAt, authorHandle, body, postOrder }] }
 *         newest-first, capped to limit (default 50, max 200).
 *     → 400 q missing/blank.
 *     → 404 roomId unknown.
 *
 * Backs the `ant terminal <name> search <q>` and `ant chat <name> search <q>`
 * CLI verbs (JWPK 2026-05-16 scope-add). Cross-room search lives at
 * /api/search-messages; this route is the per-room narrowed surface so
 * callers don't need to know any of the room-list machinery.
 *
 * The match-shape is intentionally flat (id/postedAt/authorHandle/body/
 * postOrder) — the CLI prints these directly without unpacking a hit
 * envelope, and dropping roomId/roomName saves bytes when the caller
 * already knows the room.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchMessagesInRoom } from '$lib/server/messageSearchStore';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';

export const GET: RequestHandler = ({ params, url }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }

  const rawQuery = url.searchParams.get('q');
  if (rawQuery === null || rawQuery.trim().length === 0) {
    throw error(400, 'q parameter required.');
  }

  const limit = parseLimitParam(url.searchParams.get('limit'));

  try {
    const hits = searchMessagesInRoom(params.roomId ?? '', rawQuery, limit);
    const matches = hits.map((hit: ReturnType<typeof searchMessagesInRoom>[number]) => ({
      id: hit.message.id,
      postedAt: hit.message.postedAt,
      authorHandle: hit.message.authorHandle,
      body: hit.message.body,
      postOrder: hit.message.postOrder
    }));
    return json({ matches });
  } catch (causeOfFailure) {
    const reason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not search.';
    // doesChatRoomExist already guarded the unknown-room case; any error
    // here is a query/limit problem.
    throw error(400, reason);
  }
};

function parseLimitParam(rawLimit: string | null): number | undefined {
  if (rawLimit === null) return undefined;
  const parsedNumber = Number(rawLimit);
  if (!Number.isFinite(parsedNumber)) return undefined;
  return parsedNumber;
}
