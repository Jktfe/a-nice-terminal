/**
 * Typing-heartbeat endpoint for one chat room.
 *
 * POST /api/chat-rooms/:roomId/typing  { memberHandle }
 *   → records a heartbeat. Returns 201.
 *
 * GET /api/chat-rooms/:roomId/typing
 *   → returns the current active typers (heartbeat in last 5 seconds).
 *
 * Backs M19 typing-indicator slice 1 (backend). UI wiring lands in slice 2.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listActiveTypersInRoom,
  recordTypingHeartbeat
} from '$lib/server/typingIndicatorStore';
import { doesChatRoomExist, findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = async ({ params }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  return json({ activeTypers: listActiveTypersInRoom(params.roomId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) {
    throw error(404, 'Room not found.');
  }

  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate typing POST.
  // High-frequency endpoint — the gate cascade is cheap (one resolver call).
  const auth = requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const memberHandleField = bodyAsObject.memberHandle;
  if (typeof memberHandleField !== 'string') {
    throw error(400, 'memberHandle must be a string.');
  }

  const handleWithAtSign = memberHandleField.startsWith('@')
    ? memberHandleField
    : `@${memberHandleField}`;
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }
  if (!auth.isAdminBearer && auth.handle !== handleWithAtSign) {
    throw error(403, `caller ${auth.handle} cannot record typing as ${handleWithAtSign}`);
  }

  try {
    recordTypingHeartbeat({
      roomId: params.roomId,
      memberHandle: handleWithAtSign
    });
    return json({ ok: true }, { status: 201 });
  } catch (causeOfFailure) {
    const reason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not record heartbeat.';
    throw error(400, reason);
  }
};

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object with at least memberHandle.');
  }
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
