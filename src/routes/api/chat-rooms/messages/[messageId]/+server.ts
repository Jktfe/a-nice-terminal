/**
 * GET /api/chat-rooms/messages/:messageId
 *
 * Resolve a message id to its persisted message row for CLI reply flows.
 * The route loads the message first, then applies the existing room read
 * gate to the message's room so message-id lookup does not leak private
 * room content.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { getMessageById } from '$lib/server/chatMessageStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = async ({ params, request }) => {
  const message = getMessageById(params.messageId);
  if (!message) throw error(404, 'Message not found.');

  const room = findChatRoomById(message.roomId);
  if (!room) throw error(404, 'Message not found.');

  await requireChatRoomReadAccess(request, room);
  return json({ message });
};
