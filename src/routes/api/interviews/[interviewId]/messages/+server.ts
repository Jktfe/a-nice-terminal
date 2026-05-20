/**
 * POST /api/interviews/:interviewId/messages — send a message INTO an
 * in-flight interview. Pair to PATCH /api/interviews/:id/end + POST
 * /api/chat-rooms/:roomId/interviews (M4.5 start). New CLI wrapper:
 * `ant interview send <interviewId> --msg "..."`.
 *
 * Authority mirrors the end-authority lock from /api/interviews/:id/end:
 * caller MUST be the interviewer OR the subject of THIS interview.
 * Ordinary other room members → 403 (would not be able to drive an
 * interview if they cannot end one). Interview MUST be active (still
 * has ended_at_ms === null); already-ended → 409 with hint.
 *
 * Body: { body: string, authorHandle?: string, pidChain }
 *   - body trimmed by underlying postMessage; blank → 400 from store.
 *   - authorHandle accepted but the SERVER-resolved caller handle (via
 *     resolveCallerIdentityStrict) wins — same anti-spoof posture as the
 *     end route. The client value is ignored for attribution.
 *
 * On success: posts a regular chat message into the interview's room
 * with discussion_id = interviewId so summary + downstream filters can
 * scope to the interview transcript. Returns { message } at 201.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInterviewById } from '$lib/server/interviewStore';
import { postMessage } from '$lib/server/chatMessageStore';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';

export const POST: RequestHandler = async ({ params, request }) => {
  const row = getInterviewById(params.interviewId);
  if (!row) throw error(404, 'Interview not found.');

  if (row.ended_at_ms !== null) {
    throw error(409, 'Interview has already ended; start a new one to continue.');
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with at least a body field + pidChain.');
  }

  const body = rawBody as Record<string, unknown>;

  const caller = resolveCallerIdentityStrict(row.room_id, request, body);

  // Same authority lock as the end route — interviewer OR subject only.
  if (caller !== row.interviewer && caller !== row.subject_handle) {
    throw error(403, 'Only the interviewer or the subject of this interview may send messages into it.');
  }

  const messageBody = body.body;
  if (typeof messageBody !== 'string') {
    throw error(400, 'The body field must be a string.');
  }

  try {
    const newMessage = postMessage({
      roomId: row.room_id,
      authorHandle: caller,
      body: messageBody,
      kind: 'human',
      discussion_id: row.id
    });
    try { fanoutMessageToRoomTerminals(row.room_id, newMessage); } catch { /* best-effort */ }
    try { broadcastToRoom(row.room_id, { type: 'message_added', message: newMessage }); } catch { /* best-effort */ }
    return json({ message: newMessage }, { status: 201 });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'Could not post the interview message.';
    throw error(400, reason);
  }
};
