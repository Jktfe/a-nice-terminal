/**
 * POST /api/chat-rooms/:roomId/interviews — start a new interview.
 *
 * M4.5 Q2/Q3 semantics: caller must be a current member of roomId
 * (pidChain-strict). Subject must also be a current member (404).
 * Self-interview (interviewer === subject) rejected with 400. One
 * active interview per room max — 409 on attempt to start with
 * another active.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import {
  startInterview,
  getActiveInterview,
  listInterviewsForRoom,
  InterviewSubjectNotMemberError,
  InterviewSelfInterviewError,
  InterviewAlreadyActiveError
} from '$lib/server/interviewStore';
import { postSystemMessage } from '$lib/server/chatMessageStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';

/**
 * GET /api/chat-rooms/:roomId/interviews
 *
 * Room-read-gated interview UI feed (Task #80). Returns the active interview
 * row (if any) plus the most recent 50 interviews for the room so the UI can
 * render banner + recent-history without an N+1.
 */
export const GET: RequestHandler = ({ params }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');
  return json({
    active: getActiveInterview(params.roomId),
    recent: listInterviewsForRoom(params.roomId)
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) throw error(404, 'Room not found.');

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with subjectHandle + pidChain.');
  }

  const interviewer = resolveCallerIdentityStrict(params.roomId, request, rawBody);

  const subjectRaw = (rawBody as { subjectHandle?: unknown }).subjectHandle;
  if (typeof subjectRaw !== 'string' || subjectRaw.length === 0) {
    throw error(400, 'subjectHandle (string) is required.');
  }
  const subjectHandle = subjectRaw.startsWith('@') ? subjectRaw : `@${subjectRaw}`;

  try {
    const interview = startInterview({
      roomId: params.roomId,
      interviewer,
      subjectHandle
    });
    postSystemMessage({
      roomId: params.roomId,
      body: `${interviewer} started interview with ${subjectHandle}.`
    });
    return json({ interview }, { status: 201 });
  } catch (cause) {
    if (cause instanceof InterviewSelfInterviewError) throw error(400, cause.message);
    if (cause instanceof InterviewSubjectNotMemberError) throw error(404, cause.message);
    if (cause instanceof InterviewAlreadyActiveError) throw error(409, cause.message);
    throw cause;
  }
};
