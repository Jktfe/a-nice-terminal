/**
 * Curated message queue — edit/reorder + drop a single item.
 *
 *   PATCH  /api/chat-rooms/:roomId/queue/:queueId
 *     body { curatedText?, priority?, status? }
 *     → 200 { item: QueueItem }               edited / reprioritised
 *     → 400                                    missing/malformed body, bad fields, no patch
 *     → 401                                    no identity (mutation gate)
 *     → 404                                    unknown room or unknown item
 *
 *   DELETE /api/chat-rooms/:roomId/queue/:queueId
 *     → 200 { wasActive: boolean }            true iff the item existed (now dropped)
 *     → 401                                    no identity (mutation gate)
 *     → 404                                    unknown room or unknown item
 *
 * Both mutate, so both gate via the shared chatRoomAuthGate. Curator condense,
 * user/CLI edits, and reorder all flow through PATCH; DELETE soft-drops.
 *
 * Spec: docs/curated-queue-spec.md.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import {
  getItem,
  updateItem,
  markDropped,
  type QueueStatus
} from '$lib/server/messageQueueStore';

const VALID_STATUS: ReadonlySet<string> = new Set<QueueStatus>([
  'pending',
  'working',
  'done',
  'dropped'
]);

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

export const PATCH: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  // 404 on a missing item BEFORE touching the store (matches the route
  // contract; updateItem would otherwise return null indistinguishably).
  if (!getItem(params.queueId)) {
    throw error(404, 'Queue item not found.');
  }

  const patch: { curatedText?: string; priority?: number; status?: QueueStatus } = {};

  const curatedTextRaw = bodyAsObject.curatedText;
  if (curatedTextRaw !== undefined) {
    if (typeof curatedTextRaw !== 'string') {
      throw error(400, 'curatedText must be a string when present.');
    }
    patch.curatedText = curatedTextRaw;
  }

  const priorityRaw = bodyAsObject.priority;
  if (priorityRaw !== undefined && priorityRaw !== null) {
    if (typeof priorityRaw !== 'number' || !Number.isFinite(priorityRaw)) {
      throw error(400, 'priority must be a finite number when present.');
    }
    patch.priority = priorityRaw;
  }

  const statusRaw = bodyAsObject.status;
  if (statusRaw !== undefined) {
    if (typeof statusRaw !== 'string' || !VALID_STATUS.has(statusRaw)) {
      throw error(400, 'status must be one of pending|working|done|dropped when present.');
    }
    // One-in-flight invariant (adversarial review M2): 'working' is claimed ONLY
    // by the atomic pullNext; allowing PATCH→working would let a caller create a
    // second in-flight item, sidestepping the gate. Reject it here.
    if (statusRaw === 'working') {
      throw error(400, "status 'working' is set only by pull (one-in-flight); PATCH to pending/done/dropped.");
    }
    patch.status = statusRaw as QueueStatus;
  }

  if (
    patch.curatedText === undefined &&
    patch.priority === undefined &&
    patch.status === undefined
  ) {
    throw error(400, 'At least one of curatedText, priority, or status is required.');
  }

  const item = updateItem(params.queueId, patch);
  if (!item) {
    // Raced away between the existence check and the update.
    throw error(404, 'Queue item not found.');
  }
  return json({ item });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  requireChatRoomMutationAuth(params.roomId, request, null);

  if (!getItem(params.queueId)) {
    throw error(404, 'Queue item not found.');
  }

  const wasActive = markDropped(params.queueId);
  return json({ wasActive });
};
