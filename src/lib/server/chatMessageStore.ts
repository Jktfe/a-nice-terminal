/**
 * Persisted store for chat messages.
 *
 * Phase 5.2 of ROOMS-PERSISTENCE-A (canonical RQO32LuIK8xmcV7fq04Oq design
 * PASS 2026-05-14, Phase 5.1 PASS 2026-05-14). Previously a process-memory
 * Map<roomId, ChatMessage[]>; now backed by better-sqlite3 table
 * `chat_messages` at ~/.ant/fresh-ant.db (or ANT_FRESH_DB_PATH override /
 * vitest auto-isolation). Public exports + signatures + return shapes are
 * byte-identical to the prior in-memory version per Q1 no-caller-churn lock.
 *
 * Locks per Phase 5.0 design contract (Q5 amended in delta-2 PASS 2026-05-14):
 *   Q4 — post_order INTEGER NOT NULL UNIQUE, assigned by
 *        COALESCE(MAX(post_order), 0) + 1 inside db.transaction
 *   Q5 — parent_message_id TEXT, no FK / no store-layer existence check.
 *        /messages route owns parent existence + same-room validation
 *        via validateAndResolveParentMessageId.
 *   Q6 — discussion_id TEXT (no FK, no NOT NULL) — M3.4b soft-label
 *        precedent preserved.
 *   Q7 — M3.6a-v1 auth-gate routes UNTOUCHED. Swap happens beneath the
 *        route's postMessage() / postSystemMessage() / postBreakMessage()
 *        calls; runtime behavior is restart-survival, not contract change.
 */

import { findChatRoomById } from './chatRoomStore';
import { getIdentityDb } from './db';

export type ChatMessageKind = 'human' | 'agent' | 'system' | 'system-break';

export type ChatMessage = {
  id: string;
  roomId: string;
  authorHandle: string;
  authorDisplayName: string;
  kind: ChatMessageKind;
  body: string;
  postedAt: string;
  postOrder: number;
  parentMessageId?: string;
  discussion_id?: string;
  // #74 + #76: tombstone + edit indicator. Both columns are nullable
  // and added via ALTER TABLE — rows pre-dating the migration come back
  // with these fields undefined.
  deletedAtMs?: number | null;
  deletedByHandle?: string | null;
  editedAtMs?: number | null;
};

type ChatMessageRow = {
  id: string;
  room_id: string;
  author_handle: string;
  author_display_name: string;
  kind: ChatMessageKind;
  body: string;
  posted_at: string;
  post_order: number;
  parent_message_id: string | null;
  discussion_id: string | null;
  deleted_at_ms: number | null;
  deleted_by_handle: string | null;
  edited_at_ms: number | null;
};

function makeMessageId(): string {
  const four = Math.random().toString(36).slice(2, 6);
  const six = Math.random().toString(36).slice(2, 8);
  return `msg_${four}${six}`;
}

/**
 * plan_consent_gate_2026_05_20 T6: exposed so the /messages POST route can
 * pre-allocate a message id, run the consent gate audit with it, and pass
 * the same id through to postMessage(). Keeps the gate's audit_row.message_id
 * byte-equal to the inserted chat_messages.id.
 */
export function generateMessageId(): string {
  return makeMessageId();
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  const message: ChatMessage = {
    id: row.id,
    roomId: row.room_id,
    authorHandle: row.author_handle,
    authorDisplayName: row.author_display_name,
    kind: row.kind,
    body: row.body,
    postedAt: row.posted_at,
    postOrder: row.post_order
  };
  if (row.parent_message_id !== null) message.parentMessageId = row.parent_message_id;
  if (row.discussion_id !== null) message.discussion_id = row.discussion_id;
  if (row.deleted_at_ms !== null) message.deletedAtMs = row.deleted_at_ms;
  if (row.deleted_by_handle !== null) message.deletedByHandle = row.deleted_by_handle;
  if (row.edited_at_ms !== null) message.editedAtMs = row.edited_at_ms;
  return message;
}

function insertMessageRow(input: {
  id: string;
  roomId: string;
  authorHandle: string;
  authorDisplayName: string;
  kind: ChatMessageKind;
  body: string;
  postedAt: string;
  parentMessageId: string | null;
  discussionId: string | null;
  /** plan_consent_gate_2026_05_20 T6: when an agent posts AS a human via an
   *  active human_consent_grant, this holds the consuming grant_id for the
   *  message audit row. NULL for self-posts and agent-as-agent writes. */
  consumedGrantId?: string | null;
}): ChatMessage {
  const db = getIdentityDb();
  const txn = db.transaction(() => {
    const nextOrderRow = db
      .prepare(`SELECT COALESCE(MAX(post_order), 0) + 1 AS next FROM chat_messages`)
      .get() as { next: number };
    const postOrder = nextOrderRow.next;
    db.prepare(`INSERT INTO chat_messages
      (id, room_id, author_handle, author_display_name, kind, body,
       posted_at, post_order, parent_message_id, discussion_id, consumed_grant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, input.roomId, input.authorHandle, input.authorDisplayName,
      input.kind, input.body, input.postedAt, postOrder,
      input.parentMessageId, input.discussionId,
      input.consumedGrantId ?? null
    );
    // Stamp the room with the freshest post_order so listChatRooms can
    // sort by "most recently messaged" without a per-row subquery in the
    // hot path. JWPK 2026-05-22: this REPLACES the membership-churn-
    // driven reorder; rooms only reorder when a real message lands.
    // Also bump last_update so the displayed "X minutes ago" string
    // reflects the last message time, not the last membership change.
    db.prepare(`UPDATE chat_rooms SET last_post_order = ?, last_update = ? WHERE id = ?`).run(
      postOrder, input.postedAt, input.roomId
    );
    return postOrder;
  });
  const postOrder = txn();
  const message: ChatMessage = {
    id: input.id,
    roomId: input.roomId,
    authorHandle: input.authorHandle,
    authorDisplayName: input.authorDisplayName,
    kind: input.kind,
    body: input.body,
    postedAt: input.postedAt,
    postOrder
  };
  if (input.parentMessageId !== null) message.parentMessageId = input.parentMessageId;
  if (input.discussionId !== null) message.discussion_id = input.discussionId;
  return message;
}

export function postMessage(input: {
  roomId: string;
  authorHandle: string;
  authorDisplayName?: string;
  body: string;
  kind?: 'human' | 'agent';
  parentMessageId?: string;
  discussion_id?: string;
  /** plan_consent_gate_2026_05_20 T6: optional preallocated message id so the
   *  caller (the /messages POST route) can run the consent gate BEFORE insert
   *  while passing the same id to both the audit row and this insert.
   *  Generated by makeMessageId() when omitted. */
  id?: string;
  /** plan_consent_gate_2026_05_20 T6: consuming grant_id for the audit
   *  reference column. NULL for self-posts and agent-as-agent writes. */
  consumedGrantId?: string | null;
}): ChatMessage {
  const room = findChatRoomById(input.roomId);
  if (!room) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const trimmedBody = input.body.trim();
  if (trimmedBody.length === 0) {
    throw new Error('A message needs at least one non-blank character.');
  }

  return insertMessageRow({
    id: input.id ?? makeMessageId(),
    roomId: input.roomId,
    authorHandle: input.authorHandle,
    authorDisplayName: input.authorDisplayName ?? input.authorHandle,
    kind: input.kind ?? 'human',
    body: trimmedBody,
    postedAt: new Date().toISOString(),
    parentMessageId: input.parentMessageId ?? null,
    discussionId: input.discussion_id ?? null,
    consumedGrantId: input.consumedGrantId ?? null
  });
}

export function postSystemMessage(input: { roomId: string; body: string }): ChatMessage {
  const room = findChatRoomById(input.roomId);
  if (!room) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const trimmedBody = input.body.trim();
  if (trimmedBody.length === 0) {
    throw new Error('A system message needs at least one non-blank character.');
  }

  return insertMessageRow({
    id: makeMessageId(),
    roomId: input.roomId,
    authorHandle: '@system',
    authorDisplayName: 'System',
    kind: 'system',
    body: trimmedBody,
    postedAt: new Date().toISOString(),
    parentMessageId: null,
    discussionId: null
  });
}

export function postBreakMessage(input: { roomId: string; reason?: string; postedByHandle: string }): ChatMessage {
  const room = findChatRoomById(input.roomId);
  if (!room) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const reasonTrimmed = (input.reason ?? '').trim();
  const breakBody = reasonTrimmed.length > 0
    ? `Context break by ${input.postedByHandle}: ${reasonTrimmed}`
    : `Context break by ${input.postedByHandle}.`;

  return insertMessageRow({
    id: makeMessageId(),
    roomId: input.roomId,
    authorHandle: '@system',
    authorDisplayName: 'System',
    kind: 'system-break',
    body: breakBody,
    postedAt: new Date().toISOString(),
    parentMessageId: null,
    discussionId: null
  });
}

export function listMessagesInRoom(roomId: string): ChatMessage[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT id, room_id, author_handle, author_display_name, kind,
                     body, posted_at, post_order, parent_message_id, discussion_id,
                     deleted_at_ms, deleted_by_handle, edited_at_ms
              FROM chat_messages WHERE room_id = ? ORDER BY post_order ASC`)
    .all(roomId) as ChatMessageRow[];
  return rows.map(rowToMessage);
}

export function listMessagesPageInRoom(input: {
  roomId: string;
  beforePostOrder?: number;
  limit: number;
}): { messages: ChatMessage[]; hasMore: boolean; nextBefore: number | null } {
  const normalizedLimit = Math.max(1, Math.floor(input.limit));
  const db = getIdentityDb();
  const rows = (
    input.beforePostOrder === undefined
      ? db
          .prepare(`SELECT id, room_id, author_handle, author_display_name, kind,
                           body, posted_at, post_order, parent_message_id, discussion_id,
                     deleted_at_ms, deleted_by_handle, edited_at_ms
                    FROM chat_messages
                    WHERE room_id = ?
                    ORDER BY post_order DESC
                    LIMIT ?`)
          .all(input.roomId, normalizedLimit + 1)
      : db
          .prepare(`SELECT id, room_id, author_handle, author_display_name, kind,
                           body, posted_at, post_order, parent_message_id, discussion_id,
                     deleted_at_ms, deleted_by_handle, edited_at_ms
                    FROM chat_messages
                    WHERE room_id = ? AND post_order < ?
                    ORDER BY post_order DESC
                    LIMIT ?`)
          .all(input.roomId, input.beforePostOrder, normalizedLimit + 1)
  ) as ChatMessageRow[];
  const hasMore = rows.length > normalizedLimit;
  const pageRows = rows.slice(0, normalizedLimit).reverse();
  const messages = pageRows.map(rowToMessage);
  return {
    messages,
    hasMore,
    nextBefore: hasMore && messages.length > 0 ? messages[0].postOrder : null
  };
}

/**
 * Returns the messages an agent should consider as "current context" —
 * everything posted after the most recent break in the room, plus the break
 * itself so the agent sees the boundary marker. Humans always see the full
 * history; agents see only this slice.
 */
export function listMessagesAfterLatestBreak(roomId: string): ChatMessage[] {
  const everything = listMessagesInRoom(roomId);
  const lastBreakIndex = findLastBreakIndex(everything);
  if (lastBreakIndex < 0) return everything;
  return everything.slice(lastBreakIndex);
}

function findLastBreakIndex(messagesOldestFirst: ChatMessage[]): number {
  for (let scanIndex = messagesOldestFirst.length - 1; scanIndex >= 0; scanIndex--) {
    const message = messagesOldestFirst[scanIndex];
    if (message.kind === 'system-break' && !message.deletedAtMs) return scanIndex;
  }
  return -1;
}

export function getMessageById(messageId: string): ChatMessage | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT id, room_id, author_handle, author_display_name, kind,
                     body, posted_at, post_order, parent_message_id, discussion_id,
                     deleted_at_ms, deleted_by_handle, edited_at_ms
              FROM chat_messages WHERE id = ?`)
    .get(messageId) as ChatMessageRow | undefined;
  return row ? rowToMessage(row) : null;
}

/**
 * #74 — Soft-delete a message authored by the caller. The row stays in
 * the table (post_order, parent_message_id, discussion_id all preserved
 * so threading + read-receipts still resolve), and the UI is responsible
 * for rendering "Message deleted by @x at <time>" tombstones when
 * deletedAtMs is non-null.
 *
 * Returns the updated message on success, null if the message doesn't
 * exist, the caller isn't the author, or the message is already deleted.
 * Authorship check lives here so the route can stay thin.
 */
export function softDeleteMessage(input: {
  messageId: string;
  byHandle: string;
  nowMs?: number;
}): ChatMessage | null {
  const db = getIdentityDb();
  const existing = getMessageById(input.messageId);
  if (!existing) return null;
  if (existing.authorHandle !== input.byHandle) return null;
  if (existing.deletedAtMs) return null;
  if (existing.kind === 'system' || existing.kind === 'system-break') return null;

  const nowMs = input.nowMs ?? Date.now();
  db.prepare(
    `UPDATE chat_messages SET deleted_at_ms = ?, deleted_by_handle = ? WHERE id = ?`
  ).run(nowMs, input.byHandle, input.messageId);
  return getMessageById(input.messageId);
}

/**
 * Soft-delete a context-break marker. Breaks are authored as @system, so the
 * normal author-owned softDeleteMessage path intentionally refuses them.
 * Route-level auth decides whether the caller may manage breaks in the room.
 */
export function softDeleteBreakMessage(input: {
  roomId: string;
  messageId: string;
  byHandle: string;
  nowMs?: number;
}): ChatMessage | null {
  const db = getIdentityDb();
  const existing = getMessageById(input.messageId);
  if (!existing) return null;
  if (existing.roomId !== input.roomId) return null;
  if (existing.kind !== 'system-break') return null;
  if (existing.deletedAtMs) return null;

  const nowMs = input.nowMs ?? Date.now();
  db.prepare(
    `UPDATE chat_messages SET deleted_at_ms = ?, deleted_by_handle = ? WHERE id = ?`
  ).run(nowMs, input.byHandle, input.messageId);
  return getMessageById(input.messageId);
}

/**
 * #76 — Replace the body of a message authored by the caller. Stamps
 * edited_at_ms so the UI can render "(edited)" — the previous body is
 * NOT kept here (audit retention is a separate slice).
 *
 * Returns the updated message on success, null if missing / wrong
 * author / already deleted.
 */
export function editMessageBody(input: {
  messageId: string;
  byHandle: string;
  newBody: string;
  nowMs?: number;
}): ChatMessage | null {
  const trimmed = input.newBody.trim();
  if (trimmed.length === 0) return null;
  const db = getIdentityDb();
  const existing = getMessageById(input.messageId);
  if (!existing) return null;
  if (existing.authorHandle !== input.byHandle) return null;
  if (existing.deletedAtMs) return null;
  if (existing.kind === 'system' || existing.kind === 'system-break') return null;

  const nowMs = input.nowMs ?? Date.now();
  db.prepare(
    `UPDATE chat_messages SET body = ?, edited_at_ms = ? WHERE id = ?`
  ).run(trimmed, nowMs, input.messageId);
  return getMessageById(input.messageId);
}

export function resetChatMessageStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM chat_messages').run();
}
