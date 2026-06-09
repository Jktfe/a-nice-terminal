/**
 * POST /api/chat-rooms/[roomId]/queue/curate — run the curator over the pending
 * queue for a target handle (dedupe/condense/drop-resolved/sort). Returns the
 * curator summary. Mutating → same auth gate as the rest of the queue routes.
 *
 * Body: { targetHandle: string, mode?: 'parse'|'off' }
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { curate } from '$lib/server/queueCurator';
import { reclaimStaleWorking } from '$lib/server/messageQueueStore';
import { listMembershipsForRoom } from '$lib/server/roomMembershipsStore';
import { listMembers as listDurableMembers } from '$lib/server/membershipStore';
import { getSession } from '$lib/server/antSessionStore';
import { getTerminalById } from '$lib/server/terminalsStore';
import {
  curatorModeForDeliveryMode,
  readTerminalDeliveryMode
} from '$lib/server/terminalDeliveryMode';

/** Stuck `working` items older than this rejoin `pending` (chair died mid-item). */
const STUCK_WORKING_TTL_MS = 5 * 60_000;

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) throw error(404, 'room not found');
}

function normaliseHandle(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function resolveTerminalIdForTarget(roomId: string, targetHandle: string): string | null {
  const handle = normaliseHandle(targetHandle);
  const durable = listDurableMembers(roomId).find((member) => member.handle === handle);
  if (durable?.session_id) {
    const session = getSession(durable.session_id);
    if (session?.terminal_id) return session.terminal_id;
  }
  const legacy = listMembershipsForRoom(roomId).find((membership) => membership.handle === handle);
  return legacy?.terminal_id ?? null;
}

function defaultCuratorModeForTarget(roomId: string, targetHandle: string): 'parse' | 'off' {
  const terminalId = resolveTerminalIdForTarget(roomId, targetHandle);
  if (!terminalId) return 'parse';
  const terminal = getTerminalById(terminalId);
  if (!terminal) return 'parse';
  return curatorModeForDeliveryMode(readTerminalDeliveryMode(terminal.meta));
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

  // Auth BEFORE field validation (adversarial review L3): an unauthenticated
  // caller must not be able to probe the curate contract via 400-vs-401 timing.
  requireChatRoomMutationAuth(params.roomId, request, body);

  const targetHandle = body.targetHandle;
  if (typeof targetHandle !== 'string' || targetHandle.trim().length === 0) {
    throw error(400, 'targetHandle required');
  }

  const modeRaw = body.mode;
  let mode = defaultCuratorModeForTarget(params.roomId, targetHandle);
  if (modeRaw !== undefined) {
    if (modeRaw !== 'parse' && modeRaw !== 'off') {
      throw error(400, "mode must be 'parse' or 'off' when present");
    }
    mode = modeRaw;
  }

  const stuckTtlMs = typeof body.stuckTtlMs === 'number' && body.stuckTtlMs > 0 ? body.stuckTtlMs : STUCK_WORKING_TTL_MS;
  const reclaimed = reclaimStaleWorking(params.roomId, targetHandle, stuckTtlMs);
  const summary = curate(params.roomId, targetHandle, { mode });
  return json({ reclaimed, summary });
};
