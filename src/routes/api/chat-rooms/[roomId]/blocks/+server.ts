/**
 * Room blocks — list endpoint.
 *
 *   GET /api/chat-rooms/:roomId/blocks
 *     → 200 { blocks: BlockSummary[] }   oldest first, open block last
 *     → 401                              when the caller can't read the room
 *     → 404                              when the room does not exist
 *
 * Blocks are the addressable sections of a room's history (between context
 * breaks). This lists them with their derived + stored state (open / deleted /
 * messageCount / break reason / hasSnapshot). Read-gated like every room read:
 * a caller who can't read the room can't enumerate its blocks.
 *
 * See docs/concepts/ant-room-blocks.md.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { resolveChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { listBlocks } from '$lib/server/roomBlocksStore';

export const GET: RequestHandler = async ({ request, params }) => {
  const roomId = params.roomId;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');

  const access = await resolveChatRoomReadAccess(request, roomId);
  if (!access) throw error(401, 'Authentication required.');

  return json({ blocks: listBlocks(roomId) });
};
