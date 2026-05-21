/**
 * Mark a message read, or list its readers.
 *
 *   POST /api/chat-rooms/:roomId/messages/:messageId/read
 *     Body: { readerHandle }
 *     → 201 { receipt }   the stored receipt (idempotent — second POST
 *                          from the same handle returns the first one)
 *     → 400               missing/blank readerHandle, malformed JSON
 *     → 404               unknown room, message not in this room,
 *                          or reader is not a member of the room
 *
 *   GET /api/chat-rooms/:roomId/messages/:messageId/read
 *     → 200 { readers: MessageReadReceipt[] }   mark order
 *     → 404                                      unknown room or message
 *
 * Backs M24 read-receipts slice 1 backend.
 *
 * Security: membership-before-validation matches M16 + M11 + M19 — load
 * room, then look up the message in this room, then check the reader is
 * a member, then validate other fields. Stops the door-knob test of
 * "does this message exist in any room?" from leaking through.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listMessagesInRoom } from '$lib/server/chatMessageStore';
import {
  listReadersForMessage,
  markMessageRead
} from '$lib/server/messageReadReceiptStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
import { broadcastToRoom } from '$lib/server/eventBroadcast';

export const GET: RequestHandler = ({ params }) => {
  const { room, messageBelongsToRoom } = locateRoomAndMessage(
    params.roomId,
    params.messageId
  );
  if (!room) throw error(404, 'Room not found.');
  if (!messageBelongsToRoom) throw error(404, 'Message not found in this room.');
  return json({ readers: listReadersForMessage(params.messageId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const { room, messageBelongsToRoom } = locateRoomAndMessage(
    params.roomId,
    params.messageId
  );
  if (!room) throw error(404, 'Room not found.');
  if (!messageBelongsToRoom) throw error(404, 'Message not found in this room.');

  const bodyAsObject = await parseRequiredJsonBody(request);
  const resolvedReaderHandle = resolveCallerIdentityStrict(params.roomId, request, bodyAsObject);
  const claimedReaderHandle = normalizeOptionalReaderHandle(bodyAsObject.readerHandle);
  if (claimedReaderHandle !== null && claimedReaderHandle !== resolvedReaderHandle) {
    throw error(403, 'readerHandle does not match server-resolved identity.');
  }

  const isMemberOfRoom = room.members.some((member) => member.handle === resolvedReaderHandle);
  if (!isMemberOfRoom) {
    throw error(404, `${resolvedReaderHandle} is not a member of this room.`);
  }

  try {
    const receipt = markMessageRead({
      messageId: params.messageId,
      readerHandle: resolvedReaderHandle
    });
    broadcastToRoom(params.roomId, {
      type: 'message_read',
      roomId: params.roomId,
      messageId: params.messageId,
      readerHandle: resolvedReaderHandle,
      readers: listReadersForMessage(params.messageId)
    });
    return json({ receipt }, { status: 201 });
  } catch (causeOfFailure) {
    const failureMessage =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not mark read.';
    throw error(400, failureMessage);
  }
};

function normalizeOptionalReaderHandle(rawHandle: unknown): string | null {
  if (rawHandle === undefined) return null;
  if (typeof rawHandle !== 'string' || rawHandle.trim().length === 0) {
    throw error(400, 'readerHandle must be a non-empty string when provided.');
  }
  const trimmedHandle = rawHandle.trim();
  return trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`;
}

function locateRoomAndMessage(roomId: string, messageId: string) {
  const room = findChatRoomById(roomId);
  if (!room) return { room: undefined, messageBelongsToRoom: false };
  const messageBelongsToRoom = listMessagesInRoom(roomId).some(
    (message) => message.id === messageId
  );
  return { room, messageBelongsToRoom };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
  }
  try {
    const parsed = JSON.parse(requestBodyText);
    if (!isPlainObject(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}
