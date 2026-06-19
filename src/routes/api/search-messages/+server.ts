/**
 * Search messages across every chat room (or one room when scoped).
 *
 *   GET /api/search-messages?query=...[&roomId=...][&limit=...][&allContent=1]
 *     → 200 { hits: MessageSearchHit[] }   newest first, capped to limit
 *     → 401                                 no readable-room identity
 *     → 400                                 query missing or blank
 *     → 404                                 roomId provided but unknown/unreadable
 *
 * Backs M14 search slice 1 — backend only. The /search page lands in
 * slice 2 and will hit this endpoint. Same fail-closed pattern as
 * M19 typing, M16 agent-events, M12 breaks: required params rejected
 * when blank (not just falsy), unknown rooms return 404, and the
 * limit is parsed defensively so a junk query string never crashes
 * the handler.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchMessages } from '$lib/server/messageSearchStore';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { resolveReadableRoomScope } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = async ({ request, url }) => {
  const rawQuery = url.searchParams.get('query');
  if (rawQuery === null || rawQuery.trim().length === 0) {
    throw error(400, 'query parameter required.');
  }

  const rawRoomId = url.searchParams.get('roomId');
  const roomId =
    rawRoomId !== null && rawRoomId.trim().length > 0 ? rawRoomId : undefined;

  const limit = parseLimitParam(url.searchParams.get('limit'));
  const allContent = parseBooleanParam(url.searchParams.get('allContent')) ||
    parseBooleanParam(url.searchParams.get('longMemory'));
  const afterLatestBreakOnly = roomId !== undefined && !allContent;

  if (roomId !== undefined && !doesChatRoomExist(roomId)) {
    throw error(404, 'Room not found.');
  }

  const readableScope = await resolveReadableRoomScope(request);
  if (roomId !== undefined && !readableScope.roomIds.has(roomId)) {
    throw error(404, 'Room not found.');
  }

  try {
    const hits = searchMessages({
      query: rawQuery,
      roomId,
      limit,
      afterLatestBreakOnly,
      readableRoomIds: readableScope.roomIds
    });
    return json({ hits, allContent });
  } catch (causeOfFailure) {
    const reason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not search.';
    const isUnknownRoom = reason.toLowerCase().includes('no room found');
    throw error(isUnknownRoom ? 404 : 400, reason);
  }
};

function parseLimitParam(rawLimit: string | null): number | undefined {
  if (rawLimit === null) return undefined;
  const parsedNumber = Number(rawLimit);
  if (!Number.isFinite(parsedNumber)) return undefined;
  return parsedNumber;
}

function parseBooleanParam(rawValue: string | null): boolean {
  if (rawValue === null) return false;
  const normalized = rawValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}
