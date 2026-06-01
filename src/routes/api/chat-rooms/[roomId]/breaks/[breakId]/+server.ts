/**
 * DELETE /api/chat-rooms/:roomId/breaks/:breakId
 *
 * Soft-delete a context break. Breaks are system-authored messages, so this
 * route uses room mutation auth instead of the normal author-owned message
 * delete path.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getMessageById,
  softDeleteBreakMessage
} from '$lib/server/chatMessageStore';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { broadcastToRoom } from '$lib/server/eventBroadcast';

export const DELETE: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }

  const bodyAsObject = await parseOptionalJsonBody(request);
  const auth = requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const existing = getMessageById(params.breakId);
  if (!existing || existing.roomId !== params.roomId || existing.kind !== 'system-break') {
    throw error(404, 'Break not found.');
  }

  const updated = softDeleteBreakMessage({
    roomId: params.roomId,
    messageId: params.breakId,
    byHandle: auth.handle
  });
  if (!updated) {
    throw error(409, 'Break cannot be deleted because it is already deleted.');
  }

  broadcastToRoom(params.roomId, { type: 'message_updated', message: updated });
  return new Response(null, { status: 204 });
};

async function parseOptionalJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) return {};
  try {
    const parsed = JSON.parse(requestBodyText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}
