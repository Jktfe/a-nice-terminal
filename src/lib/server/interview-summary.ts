import { nanoid } from 'nanoid';
import { queries } from './db.js';
import { mergeInterviewMeta, resolveRoomAgent } from './interviews.js';
import type { InterviewRecord } from '$lib/shared/interview-contract.js';

export interface PostInterviewSummaryInput {
  interview: InterviewRecord;
  summaryText: string;
  speakerRef: string;
  meta?: Record<string, unknown>;
}

export type PostInterviewSummaryResult = {
  ok: true;
  message: any;
  deliveries: any[];
  interview: any;
} | {
  ok: false;
  status: number;
  error: string;
};

export async function postInterviewSummary(input: PostInterviewSummaryInput): Promise<PostInterviewSummaryResult> {
  const summaryText = input.summaryText.trim();
  if (!summaryText) return { ok: false, status: 400, error: 'summary_text required' };
  if (!input.interview.source_message_id) {
    return { ok: false, status: 400, error: 'interview has no source_message_id to reply to' };
  }

  const source = queries.getMessage(input.interview.source_message_id) as any;
  if (!source || source.session_id !== input.interview.room_id) {
    return { ok: false, status: 400, error: 'source_message_id must reference a message in the interview room' };
  }

  const resolved = resolveRoomAgent(input.interview.room_id, input.speakerRef);
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
  const participant = queries.getInterviewParticipant(input.interview.id, resolved.agent.id) as any;
  if (!participant) return { ok: false, status: 400, error: 'summary speaker must be an interview participant' };

  const id = nanoid();
  const meta = {
    source: 'interview_summary',
    interview_id: input.interview.id,
    transcript_ref: input.interview.transcript_ref ?? null,
    transcript_path: input.interview.transcript_path ?? null,
    source_message_id: input.interview.source_message_id,
    summary_agent_session_id: resolved.agent.id,
    ...(input.meta ?? {}),
  };

  queries.createMessage(
    id,
    input.interview.room_id,
    'assistant',
    summaryText,
    'text',
    'complete',
    resolved.agent.id,
    null,
    input.interview.source_message_id,
    'interview_summary',
    JSON.stringify(meta),
  );
  queries.touchActivity(input.interview.room_id);

  const message = queries.getMessage(id) as any;
  const mergedMeta = mergeInterviewMeta(input.interview.meta, {
    summary_posted_by: resolved.agent.id,
    summary_message_id: id,
  });
  queries.finishInterview(
    input.interview.id,
    null,
    null,
    id,
    'posted',
    mergedMeta,
  );
  const updatedInterview = queries.getInterview(input.interview.id) as any;

  const { getRouter } = await import('./message-router.js');
  const router = getRouter();
  const result = await router.route({
    id,
    sessionId: input.interview.room_id,
    content: summaryText,
    role: 'assistant',
    senderId: resolved.agent.id,
    senderName: resolved.agent.name,
    senderType: 'terminal',
    target: null,
    replyTo: input.interview.source_message_id,
    msgType: 'interview_summary',
    meta: JSON.stringify(meta),
  });

  const { broadcast } = await import('./ws-broadcast.js');
  broadcast(input.interview.room_id, {
    type: 'interview_summary_posted',
    interview_id: input.interview.id,
    message,
    interview: updatedInterview,
  });

  return { ok: true, message, deliveries: result.deliveries, interview: updatedInterview };
}
