/**
 * interviewSummary — read-only digest builder for one interview.
 *
 * Pair to `ant interview summary <id>` + GET /api/interviews/:id/summary.
 * Heuristic digest only — NO external LLM call (per scope: minimal
 * "first / middle / last messages + counts" summarizer in the same
 * spirit as chairStore.buildDigestForRoom).
 *
 * Scope of "interview transcript": every message in the interview's room
 * that EITHER (a) has discussion_id === interviewId (canonical — what
 * `ant interview send` writes) OR (b) was posted while the interview
 * was live (started_at_ms ≤ posted_at < ended_at_ms ?? now). Both
 * branches union together so legacy / out-of-band posts during the
 * interview window are still captured, and explicitly-tagged messages
 * survive even if posted slightly outside the window after clock skew.
 *
 * Pure read functions; no writes. Safe to call from a GET endpoint.
 */

import { getInterviewById, type InterviewRow } from './interviewStore';
import { listMessagesInRoom, type ChatMessage } from './chatMessageStore';

export type InterviewMessageCount = {
  authorHandle: string;
  count: number;
};

export type InterviewSummary = {
  interview: InterviewRow;
  durationMs: number;
  status: 'active' | 'ended';
  messageCountTotal: number;
  messageCountByAuthor: InterviewMessageCount[];
  firstMessage: InterviewMessagePreview | null;
  middleMessage: InterviewMessagePreview | null;
  lastMessage: InterviewMessagePreview | null;
};

export type InterviewMessagePreview = {
  id: string;
  authorHandle: string;
  kind: ChatMessage['kind'];
  postedAt: string;
  summary: string;
};

const MAX_SUMMARY_CHARS = 120;

/**
 * Build a summary for one interview. Returns null when the interview id
 * is unknown so the caller (route) can map to a 404 cleanly.
 */
export function buildInterviewSummary(interviewId: string): InterviewSummary | null {
  const row = getInterviewById(interviewId);
  if (!row) return null;

  const allRoomMessages = listMessagesInRoom(row.room_id);
  const inScope = filterInScopeMessages(row, allRoomMessages);

  const nowMs = Date.now();
  const endedAt = row.ended_at_ms ?? nowMs;
  const durationMs = Math.max(0, endedAt - row.started_at_ms);

  const first = inScope.length > 0 ? inScope[0] : null;
  const last = inScope.length > 0 ? inScope[inScope.length - 1] : null;
  const middle = inScope.length >= 3 ? inScope[Math.floor(inScope.length / 2)] : null;

  return {
    interview: row,
    durationMs,
    status: row.ended_at_ms === null ? 'active' : 'ended',
    messageCountTotal: inScope.length,
    messageCountByAuthor: countByAuthor(inScope),
    firstMessage: first ? toPreview(first) : null,
    middleMessage: middle ? toPreview(middle) : null,
    lastMessage: last ? toPreview(last) : null
  };
}

function filterInScopeMessages(row: InterviewRow, roomMessages: ChatMessage[]): ChatMessage[] {
  const endBoundMs = row.ended_at_ms ?? Number.POSITIVE_INFINITY;
  const matching: ChatMessage[] = [];
  for (const message of roomMessages) {
    if (message.discussion_id === row.id) {
      matching.push(message);
      continue;
    }
    const postedAtMs = Date.parse(message.postedAt);
    if (Number.isFinite(postedAtMs) && postedAtMs >= row.started_at_ms && postedAtMs < endBoundMs) {
      matching.push(message);
    }
  }
  return matching;
}

function countByAuthor(messages: ChatMessage[]): InterviewMessageCount[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message.authorHandle, (counts.get(message.authorHandle) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([authorHandle, count]) => ({ authorHandle, count }))
    .sort((a, b) => b.count - a.count || a.authorHandle.localeCompare(b.authorHandle));
}

function toPreview(message: ChatMessage): InterviewMessagePreview {
  return {
    id: message.id,
    authorHandle: message.authorHandle,
    kind: message.kind,
    postedAt: message.postedAt,
    summary: summariseBody(message.body)
  };
}

function summariseBody(body: string): string {
  const cleaned = body.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= MAX_SUMMARY_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_SUMMARY_CHARS)}…`;
}
