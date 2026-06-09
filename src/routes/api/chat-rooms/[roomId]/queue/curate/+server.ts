/**
 * POST /api/chat-rooms/[roomId]/queue/curate — run the curator over the pending
 * queue for a target handle (dedupe/condense/drop-resolved/sort). Returns the
 * curator summary. Mutating → same auth gate as the rest of the queue routes.
 *
 * Body: { targetHandle: string }
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { curate } from '$lib/server/queueCurator';
import { reclaimStaleWorking } from '$lib/server/messageQueueStore';

/** Stuck `working` items older than this rejoin `pending` (chair died mid-item). */
const STUCK_WORKING_TTL_MS = 5 * 60_000;

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) throw error(404, 'room not found');
}

export const POST: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');

  const targetHandle = body.targetHandle;
  if (typeof targetHandle !== 'string' || targetHandle.trim().length === 0) {
    throw error(400, 'targetHandle required');
  }

  requireChatRoomMutationAuth(params.roomId, request, body);

  const stuckTtlMs = typeof body.stuckTtlMs === 'number' && body.stuckTtlMs > 0 ? body.stuckTtlMs : STUCK_WORKING_TTL_MS;
  const reclaimed = reclaimStaleWorking(params.roomId, targetHandle, stuckTtlMs);
  const summary = curate(params.roomId, targetHandle);
  return json({ reclaimed, summary });
};
