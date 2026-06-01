/**
 * chatDiscussionStore — per-room named side-threads with lifecycle per the
 * discussions design contract 2026-05-13 (M3.4b).
 *
 * Schema (see ./db.ts):
 *   chat_discussions(id PK, room_id, parent_message_id, title, status,
 *                    opened_by, opened_at, closed_by, closed_at, summary)
 *   UNIQUE(room_id, parent_message_id) — one discussion per parent message
 *
 * Behaviour (Q4-4b mutable re-close + Q3-3c soft-close):
 *   - createDiscussion seeds open status. UNIQUE collision throws (route maps
 *     to 409 + returns existing id).
 *   - closeOrReCloseDiscussion is idempotent: first call transitions
 *     status='open' → 'closed' AND stamps closed_by/closed_at/summary; each
 *     subsequent call updates summary + re-stamps closed_by/closed_at.
 *   - getDiscussion returns the row; listDiscussionsForRoom honours status
 *     filter (default open).
 *
 * Mirrors the roomRespondersStore.ts shape: db.transaction() for atomicity,
 * snake_case row types matching DB, prepare/all/run idiomatic.
 */
import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type DiscussionStatus = 'open' | 'closed';

export type ChatDiscussionRow = {
  id: string;
  room_id: string;
  parent_message_id: string;
  title: string | null;
  status: DiscussionStatus;
  opened_by: string;
  opened_at: number;
  closed_by: string | null;
  closed_at: number | null;
  summary: string | null;
};

export type CreateDiscussionInput = {
  roomId: string;
  parentMessageId: string;
  title?: string | null;
  opened_by: string;
};

export type CloseDiscussionInput = {
  discussionId: string;
  summary: string;
  closed_by: string;
};

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createDiscussion(input: CreateDiscussionInput): ChatDiscussionRow {
  const db = getIdentityDb();
  const id = randomUUID();
  const now = currentUnixSeconds();
  db.prepare(`INSERT INTO chat_discussions
      (id, room_id, parent_message_id, title, status, opened_by, opened_at)
      VALUES (?, ?, ?, ?, 'open', ?, ?)`).run(
    id, input.roomId, input.parentMessageId, input.title ?? null, input.opened_by, now
  );
  const row = db.prepare(`SELECT * FROM chat_discussions WHERE id = ?`).get(id) as ChatDiscussionRow;
  return row;
}

export function getDiscussion(discussionId: string): ChatDiscussionRow | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM chat_discussions WHERE id = ?`).get(discussionId) as ChatDiscussionRow | undefined;
  return row ?? null;
}

export function getDiscussionByParent(roomId: string, parentMessageId: string): ChatDiscussionRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM chat_discussions WHERE room_id = ? AND parent_message_id = ?`)
    .get(roomId, parentMessageId) as ChatDiscussionRow | undefined;
  return row ?? null;
}

export function closeOrReCloseDiscussion(input: CloseDiscussionInput): ChatDiscussionRow {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const writeTx = db.transaction(() => {
    db.prepare(`UPDATE chat_discussions
      SET status = 'closed', summary = ?, closed_by = ?, closed_at = ?
      WHERE id = ?`).run(input.summary, input.closed_by, now, input.discussionId);
  });
  writeTx();
  const row = db.prepare(`SELECT * FROM chat_discussions WHERE id = ?`).get(input.discussionId) as ChatDiscussionRow | undefined;
  if (!row) throw new Error(`closeOrReCloseDiscussion: discussion ${input.discussionId} not found`);
  return row;
}

export type ListDiscussionsFilter = DiscussionStatus | 'all';

export function listDiscussionsForRoom(roomId: string, status: ListDiscussionsFilter = 'open'): ChatDiscussionRow[] {
  const db = getIdentityDb();
  if (status === 'all') {
    return db
      .prepare(`SELECT * FROM chat_discussions WHERE room_id = ? ORDER BY opened_at DESC`)
      .all(roomId) as ChatDiscussionRow[];
  }
  return db
    .prepare(`SELECT * FROM chat_discussions WHERE room_id = ? AND status = ? ORDER BY opened_at DESC`)
    .all(roomId, status) as ChatDiscussionRow[];
}
