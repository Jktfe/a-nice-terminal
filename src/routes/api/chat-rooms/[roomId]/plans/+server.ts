/**
 * GET /api/chat-rooms/:roomId/plans — plans-for-room feed (bidirectional
 * M:N read).
 *
 * Returns each plan attached to this room with its live completion
 * rollup (computed at read time via planCompletion, no caching). Lets
 * the /rooms/:id "Plans" panel render donut + label without an N+1.
 *
 * Read access is enforced centrally by hooks.server.ts for room-scoped
 * GET APIs before this handler runs. Writes happen via /api/plans/:planId/rooms.
 *
 *   200 { plans: [{ planId, attachedAtMs, attachedBy, completion }] }
 *   400 missing roomId
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listPlansForRoom } from '$lib/server/planRoomLinkStore';

export const GET: RequestHandler = async ({ params }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'roomId is required.');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');
  const plans = listPlansForRoom(roomId);
  return json({ plans });
};
