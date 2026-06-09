/**
 * Curated message queue — list + enqueue.
 *
 *   GET    /api/chat-rooms/:roomId/queue?handle=@chair[&status=pending]
 *     → 200 { items: QueueItem[] }            ordered priority, then FIFO
 *     → 400                                    missing/blank handle, bad status
 *     → 404                                    unknown room
 *
 *   POST   /api/chat-rooms/:roomId/queue
 *     body { targetHandle, text, sourceMessageId?, kind?, priority? }
 *     → 200 { item: QueueItem }
 *     → 400                                    missing/malformed body, bad fields
 *     → 401                                    no identity (mutation gate)
 *     → 404                                    unknown room
 *
 * Exposes messageQueueStore over HTTP so the queue is a first-class, editable
 * object (user + CLI). Mutations gate via the same chatRoomAuthGate as every
 * other mutating chat-room sub-route; GET is read-only and ungated, mirroring
 * focus-mode.
 *
 * Spec: docs/curated-queue-spec.md.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import {
  enqueue,
  listQueue,
  type QueueKind,
  type QueueStatus
} from '$lib/server/messageQueueStore';

const VALID_STATUS: ReadonlySet<string> = new Set<QueueStatus>([
  'pending',
  'working',
  'done',
  'dropped'
]);
const VALID_KIND: ReadonlySet<string> = new Set<QueueKind>([
  'mention',
  'cron',
  'task',
  'manual'
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

export const GET: RequestHandler = ({ params, url }) => {
  assertRoomExists(params.roomId);

  const handle = url.searchParams.get('handle');
  if (typeof handle !== 'string' || handle.trim().length === 0) {
    throw error(400, 'handle query parameter must be a non-empty string.');
  }

  const statusRaw = url.searchParams.get('status');
  let status: QueueStatus | undefined;
  if (statusRaw !== null && statusRaw.length > 0) {
    if (!VALID_STATUS.has(statusRaw)) {
      throw error(400, 'status must be one of pending|working|done|dropped.');
    }
    status = statusRaw as QueueStatus;
  }

  return json({ items: listQueue(params.roomId, handle, { status }) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);
  // Same identity gate as every other mutating chat-room sub-route. The
  // authenticated caller is the enqueuer; resolved here, never trusted from
  // a body field.
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const targetHandle = bodyAsObject.targetHandle;
  if (typeof targetHandle !== 'string' || targetHandle.trim().length === 0) {
    throw error(400, 'targetHandle must be a non-empty string.');
  }

  const text = bodyAsObject.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw error(400, 'text must be a non-empty string.');
  }

  const sourceMessageIdRaw = bodyAsObject.sourceMessageId;
  let sourceMessageId: string | undefined;
  if (sourceMessageIdRaw !== undefined && sourceMessageIdRaw !== null) {
    if (typeof sourceMessageIdRaw !== 'string') {
      throw error(400, 'sourceMessageId must be a string when present.');
    }
    sourceMessageId = sourceMessageIdRaw;
  }

  const kindRaw = bodyAsObject.kind;
  let kind: QueueKind | undefined;
  if (kindRaw !== undefined) {
    if (typeof kindRaw !== 'string' || !VALID_KIND.has(kindRaw)) {
      throw error(400, 'kind must be one of mention|cron|task|manual when present.');
    }
    kind = kindRaw as QueueKind;
  }

  const priorityRaw = bodyAsObject.priority;
  let priority: number | undefined;
  if (priorityRaw !== undefined && priorityRaw !== null) {
    if (typeof priorityRaw !== 'number' || !Number.isFinite(priorityRaw)) {
      throw error(400, 'priority must be a finite number when present.');
    }
    priority = priorityRaw;
  }

  const item = enqueue({
    roomId: params.roomId,
    targetHandle,
    text,
    sourceMessageId,
    kind,
    priority
  });
  return json({ item });
};
