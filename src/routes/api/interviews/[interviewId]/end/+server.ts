/**
 * PATCH /api/interviews/:interviewId/end — end an active interview.
 *
 * M4.5 Q3 delta-2: TOP-LEVEL route. Route looks up the interview row
 * to derive room_id BEFORE running resolveCallerIdentityStrict, then
 * applies the Q4/Q5 invariant 2 end-authority check (caller must be
 * the interviewer OR the subject — ordinary-other-member 403).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInterviewById, endInterview } from '$lib/server/interviewStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const row = getInterviewById(params.interviewId);
  if (!row) throw error(404, 'Interview not found.');

  const rawBody = await request.json().catch(() => ({}));
  const body = (rawBody && typeof rawBody === 'object') ? (rawBody as Record<string, unknown>) : {};

  const caller = resolveCallerIdentityStrict(row.room_id, request, body);

  // M4.5 Q4 delta-1 end-authority: only interviewer OR subject.
  if (caller !== row.interviewer && caller !== row.subject_handle) {
    throw error(403, 'Only the interviewer or the subject of this interview may end it.');
  }

  const reasonRaw = body.reason;
  const reason = typeof reasonRaw === 'string' && reasonRaw.length > 0 ? reasonRaw : undefined;

  const result = endInterview(params.interviewId, reason);

  if (result.changed) {
    const suffix = reason ? `: ${reason}` : '';
    postSystemMessage({
      roomId: row.room_id,
      body: `Interview with ${row.subject_handle} ended${suffix}.`
    });
  }

  return json(result);
};
