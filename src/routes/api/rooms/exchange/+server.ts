/**
 * Compatibility alias for older/local antchat binaries observed calling
 * POST /api/rooms/exchange instead of the v4 invite routes.
 *
 * Accepts deliberately broad field aliases so a stale client can still
 * complete the first exchange:
 *   roomId | room_id | room
 *   inviteId | invite_id | invite
 *   password
 *   kind? defaults to cli
 *   handle?
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  legacyExchangeResponse,
  optionalString,
  parseJsonObject,
  parseKind,
  requireBodyString
} from '$lib/server/legacyAntchatCompat';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';

export const POST: RequestHandler = async ({ request }) => {
  const body = await parseJsonObject(request);
  const roomId = requireBodyString(body, ['roomId', 'room_id', 'room']);
  const inviteId = requireBodyString(body, ['inviteId', 'invite_id', 'invite']);
  if (!doesChatRoomExist(roomId)) throw error(404, 'Room not found.');

  return legacyExchangeResponse({
    roomId,
    inviteId,
    password: requireBodyString(body, ['password']),
    kind: parseKind(body.kind),
    handle: optionalString(body, ['handle'])
  });
};
