/**
 * Focus mode — per-room, per-member head-down signal.
 *
 *   GET    /api/chat-rooms/:roomId/focus-mode
 *     → 200 { focusedMembers: FocusEntry[] }   oldest-first
 *     → 404                                    unknown room
 *
 *   PUT    /api/chat-rooms/:roomId/focus-mode
 *     body { memberHandle, reason? }
 *     → 200 { focusEntry }                     idempotent replace
 *     → 400                                    missing/malformed body, blank/missing memberHandle, reason too long
 *     → 404                                    unknown room or non-member
 *
 *   DELETE /api/chat-rooms/:roomId/focus-mode
 *     body { memberHandle }
 *     → 200 { wasActive: boolean }
 *     → 400                                    missing/malformed body, blank memberHandle
 *     → 404                                    unknown room
 *
 * Backs the "Focus mode" capability ledger row. UI wiring is a later
 * slice; this surface stays additive over the accepted membership pattern.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  enterFocus,
  exitFocus,
  listFocusedMembersInRoom
} from '$lib/server/focusModeStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

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

export const GET: RequestHandler = ({ params }) => {
  assertRoomExists(params.roomId);
  return json({ focusedMembers: listFocusedMembersInRoom(params.roomId) });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate focus-mode PUT.
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const memberHandle = bodyAsObject.memberHandle;
  if (typeof memberHandle !== 'string' || memberHandle.trim().length === 0) {
    throw error(400, 'memberHandle must be a non-empty string.');
  }

  const reasonRaw = bodyAsObject.reason;
  let reason: string | undefined;
  if (reasonRaw !== undefined) {
    if (typeof reasonRaw !== 'string') {
      throw error(400, 'reason must be a string when present.');
    }
    reason = reasonRaw;
  }

  // FOCUS-DURATION (2026-05-15, JWPK): optional auto-clear timer in ms.
  // CLI/UI does the human-string parsing ("30m" → 1_800_000); server
  // stamps the absolute expiresAt. Omit/null = indefinite.
  const durationMsRaw = bodyAsObject.durationMs;
  let durationMs: number | undefined;
  if (durationMsRaw !== undefined && durationMsRaw !== null) {
    if (typeof durationMsRaw !== 'number' || !Number.isFinite(durationMsRaw) || durationMsRaw <= 0) {
      throw error(400, 'durationMs must be a positive finite number when present.');
    }
    durationMs = durationMsRaw;
  }

  try {
    const focusEntry = enterFocus({
      roomId: params.roomId,
      memberHandle,
      reason,
      durationMs
    });
    return json({ focusEntry });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not enter focus.';
    if (message.includes('not a member')) {
      throw error(404, message);
    }
    throw error(400, message);
  }
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate focus-mode DELETE.
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const memberHandle = bodyAsObject.memberHandle;
  if (typeof memberHandle !== 'string' || memberHandle.trim().length === 0) {
    throw error(400, 'memberHandle must be a non-empty string.');
  }

  const wasActive = exitFocus({ roomId: params.roomId, memberHandle });
  return json({ wasActive });
};
