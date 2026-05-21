/**
 * Post a context break into one chat room.
 *
 * POST /api/chat-rooms/:roomId/breaks  { reason?, postedByHandle? }
 *   → returns the break message that was added.
 *
 * Backs M12 break-context. Humans always see the full message history;
 * agents only see messages from the most recent break onwards.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { postBreakMessage } from '$lib/server/chatMessageStore';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

export const POST: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }

  const bodyAsObject = await parseOptionalJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate breaks POST.
  // Without this any unauthenticated caller could post a context break,
  // truncating every agent's visible history in the room.
  requireChatRoomMutationAuth(params.roomId, request, bodyAsObject);

  const reasonField = bodyAsObject.reason;
  const reason = typeof reasonField === 'string' ? reasonField : undefined;

  const postedByHandleField = bodyAsObject.postedByHandle;
  const postedByHandle =
    typeof postedByHandleField === 'string' && postedByHandleField.length > 0
      ? postedByHandleField
      : '@you';

  try {
    const newBreak = postBreakMessage({
      roomId: params.roomId,
      reason,
      postedByHandle
    });
    return json({ message: newBreak }, { status: 201 });
  } catch (causeOfFailure) {
    const failureReason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not post the break.';
    throw error(400, failureReason);
  }
};

/**
 * A context break is irreversible inside the agent context window, so we never
 * silently fall through on a malformed body. An empty body is OK (use defaults);
 * unparseable JSON is rejected with 400.
 */
async function parseOptionalJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) return {};
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
