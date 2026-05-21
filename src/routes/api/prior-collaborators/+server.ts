/**
 * Cross-room prior collaborators for the mention autocomplete.
 *
 *   GET /api/prior-collaborators?excludeRoomId=X[&partialMatch=foo]
 *     → 200 { handles: string[] }  alphabetically sorted, one row per handle
 *     → 400                        excludeRoomId query param missing
 *
 * Backs M03 slice 4.1 — h05 alias-aware autocomplete third tier. The
 * caller is expected to be the active room composer, so excludeRoomId
 * is required to keep the suggestion list focused on people who are
 * NOT already members of the current room.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPriorCollaboratorsExcludingRoom } from '$lib/server/chatRoomParticipationHistoryStore';

export const GET: RequestHandler = ({ url }) => {
  const rawExcludeRoomId = url.searchParams.get('excludeRoomId') ?? '';
  const excludeRoomId = rawExcludeRoomId.trim();
  if (excludeRoomId.length === 0) {
    throw error(400, 'excludeRoomId query parameter required.');
  }
  const partialMatch = url.searchParams.get('partialMatch') ?? '';
  const handles = listPriorCollaboratorsExcludingRoom(excludeRoomId, partialMatch);
  return json({ handles });
};
