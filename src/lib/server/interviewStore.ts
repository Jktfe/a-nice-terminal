/**
 * interviewStore — M4.5 interview state + append-only history.
 *
 * Per Q1-Q5 locks:
 *   - one active interview per room (start rejects when another active)
 *   - subject MUST be a current room member (404 at route layer)
 *   - interviewer !== subject (400 at route layer)
 *   - end is idempotent on already-ended (200, changed=false)
 *   - end authority = interviewer OR subject only (403 ordinary other)
 *
 * Store stays narrow — invariants the store owns: room exists,
 * subject-member presence, no-active-in-room, interviewer!==subject.
 * Route owns: caller-pidChain resolve + end-authority check (after
 * fetching the interview row to know who the parties are).
 */
import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import { findChatRoomById } from './chatRoomStore';

export type InterviewRow = {
  id: string;
  room_id: string;
  interviewer: string;
  subject_handle: string;
  started_at_ms: number;
  ended_at_ms: number | null;
  end_reason: string | null;
};

export type StartInterviewInput = {
  roomId: string;
  interviewer: string;
  subjectHandle: string;
  nowMs?: number;
};

export class InterviewSubjectNotMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterviewSubjectNotMemberError';
  }
}

export class InterviewSelfInterviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterviewSelfInterviewError';
  }
}

export class InterviewAlreadyActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterviewAlreadyActiveError';
  }
}

function isMember(roomId: string, handle: string): boolean {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT 1 AS present FROM chat_room_members WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as { present: number } | undefined;
  return row !== undefined;
}

export function getActiveInterview(roomId: string): InterviewRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM chat_room_interviews
              WHERE room_id = ? AND ended_at_ms IS NULL
              ORDER BY started_at_ms DESC LIMIT 1`)
    .get(roomId) as InterviewRow | undefined;
  return row ?? null;
}

export function getInterviewById(interviewId: string): InterviewRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM chat_room_interviews WHERE id = ?`)
    .get(interviewId) as InterviewRow | undefined;
  return row ?? null;
}

export function startInterview(input: StartInterviewInput): InterviewRow {
  const room = findChatRoomById(input.roomId);
  if (!room) throw new Error(`No room found with id ${input.roomId}.`);

  if (input.interviewer === input.subjectHandle) {
    throw new InterviewSelfInterviewError('Interviewer and subject must differ.');
  }
  if (!isMember(input.roomId, input.subjectHandle)) {
    throw new InterviewSubjectNotMemberError(
      `${input.subjectHandle} is not a member of room ${input.roomId}.`
    );
  }
  const existing = getActiveInterview(input.roomId);
  if (existing) {
    throw new InterviewAlreadyActiveError(
      `Room ${input.roomId} already has active interview ${existing.id}.`
    );
  }

  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const interviewId = `iv_${randomUUID().slice(0, 12)}`;

  const txn = db.transaction(() => {
    db.prepare(`INSERT INTO chat_room_interviews
      (id, room_id, interviewer, subject_handle, started_at_ms, ended_at_ms, end_reason)
      VALUES (?, ?, ?, ?, ?, NULL, NULL)`).run(
      interviewId, input.roomId, input.interviewer, input.subjectHandle, nowMs
    );
    db.prepare(`UPDATE chat_rooms SET current_interview_id = ? WHERE id = ?`).run(
      interviewId, input.roomId
    );
  });
  txn();

  return getInterviewById(interviewId)!;
}

export type EndInterviewResult = {
  interview: InterviewRow;
  changed: boolean;
};

export function endInterview(interviewId: string, reason?: string, nowMs?: number): EndInterviewResult {
  const row = getInterviewById(interviewId);
  if (!row) throw new Error(`No interview found with id ${interviewId}.`);

  if (row.ended_at_ms !== null) {
    return { interview: row, changed: false };
  }

  const db = getIdentityDb();
  const ts = nowMs ?? Date.now();
  const txn = db.transaction(() => {
    db.prepare(`UPDATE chat_room_interviews SET ended_at_ms = ?, end_reason = ? WHERE id = ?`).run(
      ts, reason ?? null, interviewId
    );
    db.prepare(`UPDATE chat_rooms SET current_interview_id = NULL WHERE id = ? AND current_interview_id = ?`).run(
      row.room_id, interviewId
    );
  });
  txn();

  return { interview: getInterviewById(interviewId)!, changed: true };
}

export function listInterviewsForRoom(roomId: string, limit: number = 50): InterviewRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM chat_room_interviews WHERE room_id = ?
              ORDER BY started_at_ms DESC LIMIT ?`)
    .all(roomId, limit) as InterviewRow[];
}

export function resetInterviewStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM chat_room_interviews').run();
  db.prepare('UPDATE chat_rooms SET current_interview_id = NULL').run();
}
