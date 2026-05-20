/**
 * Rename one chat room.
 *
 * PATCH /api/chat-rooms/:roomId/name  { newName }
 *   → updates room.name, posts a "Room renamed from <old> to <new>"
 *     system message, returns 200 with the updated room.
 *
 * Backs M13 rename-a-chatroom. Mirrors the fail-closed body-parsing pattern
 * from M12 breaks + M19 typing + M16 agent-events.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist, renameChatRoom } from '$lib/server/chatRoomStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const PATCH: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }

  const bodyAsObject = await parseRequiredJsonBody(request);

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): identity-gate every
  // mutating sub-route. Without this any unauthenticated caller could rename
  // any room in the instance.
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const newNameField = bodyAsObject.newName;
  if (typeof newNameField !== 'string' || newNameField.trim().length === 0) {
    throw error(400, 'newName must be a non-empty string.');
  }

  try {
    const { previousName, chatRoom } = renameChatRoom({
      roomId: params.roomId,
      newName: newNameField
    });
    postSystemMessage({
      roomId: params.roomId,
      body: `Room renamed from "${previousName}" to "${chatRoom.name}".`
    });
    return json({ chatRoom }, { status: 200 });
  } catch (causeOfFailure) {
    const reason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not rename the room.';
    throw error(400, reason);
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object with newName.');
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
