/**
 * Roll one ask into another.
 *
 *   POST /api/asks/:askId/merge
 *     Body: { intoAskId, mergedByHandle, mergedByDisplayName? }
 *     → 200 { ask }   the updated source ask (status='merged')
 *     → 400           validation failure (already-resolved source, status
 *                     mismatch on into, cross-target-handle merge, self-merge,
 *                     missing fields)
 *     → 404           unknown askId / unknown intoAskId / source room missing
 *
 * Premium-stub for the native-app Chair feature (JWPK 2026-05-22). 'merged'
 * is NON-TERMINAL: the askee's response-required pill stays lit because the
 * merged-into ask still owes a response. RESPONSE_REQUIRED_STATUSES guards
 * that invariant in askStore. Audit trail preserved via the four merge
 * columns added in slice 1 (merged_into_ask_id, merged_at_ms,
 * merged_by_handle on the source row).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { canonicalOperatorHandleForMembers } from '$lib/operatorSentinel';
import { findAskById, mergeAsks } from '$lib/server/askStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const POST: RequestHandler = async ({ params, request }) => {
  const source = findAskById(params.askId);
  if (!source) throw error(404, 'Ask not found.');
  const room = findChatRoomById(source.roomId);
  if (!room) throw error(404, 'The room for this ask no longer exists.');

  const bodyAsObject = await parseRequiredJsonBody(request);
  requireChatRoomMutationAuth(source.roomId, request, bodyAsObject);

  const intoAskIdRaw = bodyAsObject.intoAskId;
  if (typeof intoAskIdRaw !== 'string' || intoAskIdRaw.trim().length === 0) {
    throw error(400, 'intoAskId must be a non-empty string.');
  }
  const intoAskId = intoAskIdRaw.trim();
  if (!findAskById(intoAskId)) {
    throw error(404, `Ask ${intoAskId} not found.`);
  }

  const mergedByHandleRaw = bodyAsObject.mergedByHandle;
  if (typeof mergedByHandleRaw !== 'string' || mergedByHandleRaw.trim().length === 0) {
    throw error(400, 'mergedByHandle must be a non-empty string.');
  }
  const trimmedHandle = mergedByHandleRaw.trim();
  const handleWithAtSign = canonicalOperatorHandleForMembers(
    trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`,
    room.members
  );
  const isMemberOfRoom = room.members.some((member) => member.handle === handleWithAtSign);
  if (!isMemberOfRoom) {
    throw error(404, `${handleWithAtSign} is not a member of this room.`);
  }

  try {
    const updated = mergeAsks({
      sourceAskId: source.id,
      intoAskId,
      mergedByHandle: handleWithAtSign
    });
    return json({ ask: updated });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not merge ask.';
    throw error(400, message);
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
    if (!isPlainObject(parsed)) throw error(400, 'Body must be a JSON object.');
    return parsed;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw parseFailure;
  }
}
