/**
 * Curated message queue — pull the next item for the worker.
 *
 *   POST   /api/chat-rooms/:roomId/queue/pull
 *     body { targetHandle }
 *     → 200 { item: QueueItem }               next pending claimed → working
 *     → 200 { item: null }                    nothing to pull, OR one already in-flight
 *     → 400                                    missing/malformed body, blank targetHandle
 *     → 401                                    no identity (mutation gate)
 *     → 404                                    unknown room
 *
 * One-in-flight: the store returns null if an item is already `working` for
 * this (room, targetHandle), so the capacity gate can't double-release. This
 * is a mutating claim, so it gates via the shared chatRoomAuthGate.
 *
 * Spec: docs/curated-queue-spec.md.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { pullNext } from '$lib/server/messageQueueStore';

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) {
    throw error(404, 'Room not found.');
  }
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
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

export const POST: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const targetHandle = bodyAsObject.targetHandle;
  if (typeof targetHandle !== 'string' || targetHandle.trim().length === 0) {
    throw error(400, 'targetHandle must be a non-empty string.');
  }

  const item = pullNext(params.roomId, targetHandle);
  return json({ item });
};
