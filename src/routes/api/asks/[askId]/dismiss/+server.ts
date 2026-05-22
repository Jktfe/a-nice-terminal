/**
 * Move one ask from open to dismissed.
 *
 *   POST /api/asks/:askId/dismiss
 *     Body: { dismissedByHandle, dismissedByDisplayName? }
 *     → 200 { ask }   the updated ask (status=dismissed)
 *     → 400           missing/blank fields, malformed JSON, already-resolved
 *     → 404           unknown askId, the ask's room no longer exists,
 *                     or dismissedByHandle is not a member of that room
 *
 * Backs asks slice 2 backend. Mirrors /answer endpoint membership-before-
 * validation flow. Same no-mutate-after-failure guarantee.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { dismissAsk, findAskById, hasResponseRequiredAsksForHandle } from '$lib/server/askStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';

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

  const dismissedByHandleRaw = bodyAsObject.dismissedByHandle;
  if (typeof dismissedByHandleRaw !== 'string' || dismissedByHandleRaw.trim().length === 0) {
    throw error(400, 'dismissedByHandle must be a non-empty string.');
  }
  const trimmedHandle = dismissedByHandleRaw.trim();
  const handleWithAtSign = trimmedHandle.startsWith('@')
    ? trimmedHandle
    : `@${trimmedHandle}`;
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  const dismissedByDisplayNameRaw = bodyAsObject.dismissedByDisplayName;
  const dismissedByDisplayName =
    typeof dismissedByDisplayNameRaw === 'string' ? dismissedByDisplayNameRaw : undefined;

  try {
    const updatedAsk = dismissAsk({
      askId: ask.id,
      dismissedByHandle: handleWithAtSign,
      dismissedByDisplayName
    });
    // Asks-as-pill (slice 4): tell the room the askee's pill MAY have flipped.
    // Same shape as the /answer broadcast so a single client handler covers
    // both resolutions. Dismiss is silent in-chat (no system message) — the
    // ask just disappears from the inbox.
    if (ask.targetHandle) {
      try {
        broadcastToRoom(ask.roomId, {
          type: 'ask_resolved',
          askId: ask.id,
          targetHandle: ask.targetHandle,
          status: updatedAsk.status,
          stillResponseRequired: hasResponseRequiredAsksForHandle(ask.targetHandle)
        });
      } catch {
        /* pill broadcast best-effort */
      }
    }
    return json({ ask: updatedAsk });
  } catch (causeOfFailure) {
    const failureMessage =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not dismiss ask.';
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
