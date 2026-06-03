/**
 * Move one ask from open to deferred.
 *
 *   POST /api/asks/:askId/defer
 *     Body: { deferredByHandle }
 *     → 200 { ask }   the updated ask (status=deferred)
 *     → 400           missing/blank fields, malformed JSON, already-resolved
 *     → 404           unknown askId, the ask's room no longer exists,
 *                     or deferredByHandle is not a member of that room
 *
 * Defer is intentionally not terminal: it keeps the askee's response-required
 * pill alive and the ask visible in active ask lists.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { canonicalOperatorHandleForMembers } from '$lib/operatorSentinel';
import { deferAsk, findAskById, hasResponseRequiredAsksForHandle } from '$lib/server/askStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { inboxRoomIdFor } from '$lib/server/humanInboxRoomStore';

export const POST: RequestHandler = async ({ params, request }) => {
  const ask = findAskById(params.askId);
  if (!ask) {
    throw error(404, 'Ask not found.');
  }
  const room = findChatRoomById(ask.roomId);
  if (!room) {
    throw error(404, 'The room for this ask no longer exists.');
  }

  const bodyAsObject = await parseRequiredJsonBody(request);

  const deferredByHandleRaw = bodyAsObject.deferredByHandle;
  if (typeof deferredByHandleRaw !== 'string' || deferredByHandleRaw.trim().length === 0) {
    throw error(400, 'deferredByHandle must be a non-empty string.');
  }
  const trimmedHandle = deferredByHandleRaw.trim();
  const handleWithAtSign = canonicalOperatorHandleForMembers(
    trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`,
    room.members
  );
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  try {
    const updatedAsk = deferAsk({
      askId: ask.id,
      deferredByHandle: handleWithAtSign
    });
    if (ask.targetHandle) {
      const askResolvedPayload = {
        type: 'ask_resolved' as const,
        askId: ask.id,
        targetHandle: ask.targetHandle,
        status: updatedAsk.status,
        stillResponseRequired: hasResponseRequiredAsksForHandle(ask.targetHandle)
      };
      try {
        broadcastToRoom(ask.roomId, askResolvedPayload);
      } catch {
        /* pill broadcast best-effort */
      }
      try {
        broadcastToRoom(inboxRoomIdFor(ask.targetHandle), askResolvedPayload);
      } catch {
        /* inbox broadcast best-effort */
      }
    }
    return json({ ask: updatedAsk });
  } catch (causeOfFailure) {
    const failureMessage =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not defer ask.';
    throw error(400, failureMessage);
  }
};

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
