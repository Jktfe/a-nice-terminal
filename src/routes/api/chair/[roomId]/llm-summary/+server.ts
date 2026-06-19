/**
 * Chair LLM summary push endpoint — thin wrapper over M29 slice 4a
 * setLLMSummaryForRoom / clearLLMSummaryForRoom seam.
 *
 *   PUT    /api/chair/:roomId/llm-summary   body { summary: string }
 *     → 200 { roomId }    idempotent overwrite
 *     → 400               missing/malformed body, non-string summary,
 *                         blank-after-trim
 *     → 404               unknown room (room-existence checked BEFORE
 *                         body parse so no mutation occurs)
 *
 *   DELETE /api/chair/:roomId/llm-summary
 *     → 200 { roomId }    always, idempotent, room-existence-independent
 *
 * Slice 4b — endpoint only. No LLM call, no caller, no scheduler. Future
 * slice 4c will land the actual cheap-model caller; slice 4b just makes
 * the seam pushable from any future caller (or curl for testing).
 *
 * DELETE deliberately skips the room-existence check. Rationale: the
 * caller's post-condition (no stored summary for that roomId) is
 * identical regardless of whether the room exists. Returning 200 on
 * unknown rooms avoids race conditions between room deletion and summary
 * clear.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  clearLLMSummaryForRoom,
  setLLMSummaryForRoom
} from '$lib/server/chairStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

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

export const PUT: RequestHandler = async ({ params, request }) => {
  requireChatRoomMutationAuth(params.roomId, request, null);
  if (!findChatRoomById(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  const bodyAsObject = await parseRequiredJsonBody(request);

  const summary = bodyAsObject.summary;
  if (typeof summary !== 'string') {
    throw error(400, 'summary must be a string.');
  }

  try {
    setLLMSummaryForRoom({ roomId: params.roomId, summary });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not save summary.';
    throw error(400, message);
  }
  return json({ roomId: params.roomId });
};

export const DELETE: RequestHandler = ({ params, request }) => {
  requireChatRoomMutationAuth(params.roomId, request, null);
  clearLLMSummaryForRoom(params.roomId);
  return json({ roomId: params.roomId });
};
