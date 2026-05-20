/**
 * Pending-and-chasing query store for the caller's handle.
 *
 * Backs `ant chat pending` (mentions awaiting a reply from the caller) and
 * `ant status chasing` (threads the caller is the most-recent speaker in
 * and that have gone quiet). Pure aggregation over the existing
 * chat_messages + chat_room_members + chat_rooms tables — NO new tables,
 * NO new columns. Uses better-sqlite3 in-process via getIdentityDb().
 *
 * v1 semantics (kept intentionally simple — picked the simplest defensible
 * definition; revisit when read-marks become per-(room, handle) persisted):
 *
 *   listPendingForHandle(handle, sinceMs?):
 *     For every room where `handle` is a member, return messages where
 *       (a) author_handle != handle
 *       (b) kind IN ('human', 'agent')  — skip system / system-break
 *       (c) body contains the literal token "@handle" (mention)
 *       (d) no descendant message exists with parent_message_id = m.id
 *           AND author_handle = handle (caller has not threaded a reply)
 *       (e) optional: posted_at >= sinceMs (epoch-ms; we parse the ISO
 *           string with strftime('%s', posted_at) * 1000)
 *     Returns ChatMessage[] oldest-first, all rooms interleaved by
 *     post_order ASC (global cross-room ordering, since the index already
 *     covers post_order). Skips rooms that are soft-deleted or archived.
 *
 *   listChasingForHandle(handle, minIdleMinutes?):
 *     For every room where `handle` is a member, find the most-recent
 *     non-system message (kind IN human/agent). If its author_handle =
 *     handle AND its posted_at is at least minIdleMinutes minutes old,
 *     include it. Returns ChatMessage[] ordered oldest-first (so longest-
 *     idle threads sit at the bottom — matches the chat-tail rendering
 *     convention).
 *     Default minIdleMinutes = 30. Caller passes 0 to see every "I-spoke-
 *     last" room with no idle floor.
 *
 * Both functions return [] when the caller is in zero rooms, or has
 * nothing matching. They never throw on missing handle — they simply
 * have nothing to match.
 *
 * Q1 lock: no new tables. Q2: the `@handle` LIKE pattern is anchored on
 * a word-ish boundary by sandwiching with spaces or by stripping known
 * trailing punctuation in the query — the SQL uses LIKE with %@handle%
 * for v1 simplicity, which is good enough for the common case
 * (`@you what about X`) and accepted to overmatch occasional inline
 * substrings (`@yourpost` matches `@you`). The CLI surface can tighten
 * post-launch without changing the public store signature.
 */

import { getIdentityDb } from './db';
import type { ChatMessage, ChatMessageKind } from './chatMessageStore';

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
};

function normaliseHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
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
  return message;
}

/**
 * Messages addressed to the caller that the caller has not threaded a
 * reply to. See file-header for the full definition.
 */
export function listPendingForHandle(
  rawHandle: string,
  sinceMs?: number
): ChatMessage[] {
  const handle = normaliseHandle(rawHandle);
  if (handle.length === 0) return [];

  const db = getIdentityDb();
  // Mention pattern: %@handle% — overmatches by design (see header).
  const mentionPattern = `%${handle}%`;
  // sinceMs filter: SQLite can compare ISO-8601 lexicographically because
  // 'YYYY-MM-DDTHH:MM:SS.sssZ' sorts identically to wall-clock time. We
  // convert sinceMs to its ISO form once and compare strings.
  const sinceIso =
    typeof sinceMs === 'number' && Number.isFinite(sinceMs) && sinceMs > 0
      ? new Date(sinceMs).toISOString()
      : null;

  const baseSql = `
    SELECT m.id, m.room_id, m.author_handle, m.author_display_name,
           m.kind, m.body, m.posted_at, m.post_order,
           m.parent_message_id, m.discussion_id
      FROM chat_messages m
      JOIN chat_room_members cm ON cm.room_id = m.room_id AND cm.handle = ?
      JOIN chat_rooms r ON r.id = m.room_id
     WHERE m.author_handle != ?
       AND m.kind IN ('human', 'agent')
       AND m.body LIKE ?
       AND r.deleted_at_ms IS NULL
       AND r.archived_at_ms IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM chat_messages reply
          WHERE reply.parent_message_id = m.id
            AND reply.author_handle = ?
       )
       ${sinceIso ? 'AND m.posted_at >= ?' : ''}
     ORDER BY m.post_order ASC`;

  const params: unknown[] = [handle, handle, mentionPattern, handle];
  if (sinceIso) params.push(sinceIso);

  const rows = db.prepare(baseSql).all(...params) as ChatMessageRow[];
  return rows.map(rowToMessage);
}

/**
 * Threads the caller is the most-recent speaker in and that have gone
 * quiet for at least `minIdleMinutes`. See file-header for the full
 * definition.
 */
export function listChasingForHandle(
  rawHandle: string,
  minIdleMinutes: number = 30
): ChatMessage[] {
  const handle = normaliseHandle(rawHandle);
  if (handle.length === 0) return [];
  const idleFloorMinutes = Math.max(0, Number.isFinite(minIdleMinutes) ? minIdleMinutes : 30);

  const db = getIdentityDb();
  // We find the per-room latest non-system message via a correlated
  // subquery on post_order (already indexed by room_id + post_order ASC).
  // Then keep only the rows where author_handle = caller and the message
  // is at least idleFloorMinutes minutes old.
  const cutoffIso = new Date(Date.now() - idleFloorMinutes * 60_000).toISOString();

  const sql = `
    SELECT m.id, m.room_id, m.author_handle, m.author_display_name,
           m.kind, m.body, m.posted_at, m.post_order,
           m.parent_message_id, m.discussion_id
      FROM chat_messages m
      JOIN chat_room_members cm ON cm.room_id = m.room_id AND cm.handle = ?
      JOIN chat_rooms r ON r.id = m.room_id
     WHERE m.author_handle = ?
       AND m.kind IN ('human', 'agent')
       AND r.deleted_at_ms IS NULL
       AND r.archived_at_ms IS NULL
       AND m.posted_at <= ?
       AND m.post_order = (
         SELECT MAX(latest.post_order) FROM chat_messages latest
          WHERE latest.room_id = m.room_id
            AND latest.kind IN ('human', 'agent')
       )
     ORDER BY m.post_order ASC`;

  const rows = db.prepare(sql).all(handle, handle, cutoffIso) as ChatMessageRow[];
  return rows.map(rowToMessage);
}
