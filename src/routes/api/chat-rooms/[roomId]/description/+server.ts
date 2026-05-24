/**
 * PATCH /api/chat-rooms/:roomId/description  { description: string | null }
 *   → updates room.description and posts a system message noting the change.
 *
 * JWPK 2026-05-24 yz4clwzvbm msg_jj50zw48fr: "optional description that can be
 * set by a user or agent like changing the room name". Mirrors the auth + body
 * parsing shape of /name. Pass null or empty string to clear the description.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  doesChatRoomExist,
  updateChatRoomDescription,
  ROOM_DESCRIPTION_MAX_CHARS
} from '$lib/server/chatRoomStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const PATCH: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }

  const bodyAsObject = await parseRequiredJsonBody(request);

  // Same mutation-gate as /name: must be admin-bearer, accounts/local-bearer,
  // or browser-session cookie scoped to this room. Without this any caller
  // could overwrite the description.
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const descriptionField = bodyAsObject.description;
  // Accept string or explicit null. Anything else is a 400.
  if (descriptionField !== null && typeof descriptionField !== 'string') {
    throw error(400, 'description must be a string or null.');
  }

  try {
    const chatRoom = updateChatRoomDescription({
      roomId: params.roomId,
      description: descriptionField
    });
    const action = chatRoom.description === null ? 'cleared' : 'updated';
    postSystemMessage({
      roomId: params.roomId,
      body: `Room description ${action}.`
    });
    return json({ chatRoom }, { status: 200 });
  } catch (causeOfFailure) {
    const reason = causeOfFailure instanceof Error
      ? causeOfFailure.message
      : 'Could not update the description.';
    throw error(400, reason);
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, `Body must be a JSON object with description (max ${ROOM_DESCRIPTION_MAX_CHARS} chars).`);
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
