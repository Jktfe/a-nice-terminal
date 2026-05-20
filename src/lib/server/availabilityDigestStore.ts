/**
 * availabilityDigestStore — surfaces the messages a handle missed
 * while its terminal was idle, computed at read-time from existing
 * chat_agent_status_events + chat_messages rows.
 *
 * JWPK msg_x1rkogssez 2026-05-19: "when an agent says they are
 * available it should show which messages didn't get picked up".
 *
 * Strategy (read-time, no new write path):
 *   1. For a handle, find the terminal row via room_memberships.
 *   2. Read chat_agent_status_events for that terminal, find the most
 *      recent IDLE window: the last contiguous run of events where
 *      new_status='idle' followed by an event where new_status !=
 *      'idle' (the wake-up). If the terminal is currently idle, the
 *      window is open-ended (since last idle entry → now).
 *   3. Query chat_messages where (a) roomId in rooms the terminal
 *      is a member of, (b) postedAt is inside the idle window, and
 *      (c) body bare-mentions the handle.
 *   4. Return the list, newest-first, with room name + a 200-char
 *      preview so the caller can render a compact 'You missed N
 *      messages' digest.
 *
 * Read-time computation means there's nothing to migrate + the digest
 * stays correct even if the idle window changes (e.g. status churns
 * during a deploy). Cost is bounded — the chat_agent_status_events
 * scan is per-terminal, and message lookups use the room+postedAt
 * index that already exists.
 */

import { getIdentityDb } from './db';
import { listBareMentionHandles } from '../chat/mentionRouting';

export type MissedMessage = {
  messageId: string;
  roomId: string;
  roomName: string;
  authorHandle: string;
  authorDisplayName: string;
  postedAt: string;
  bodyPreview: string;
};

export type AvailabilityDigest = {
  handle: string;
  terminalId: string | null;
  /** Window start (ms) the digest covers. null if the terminal has no
   *  recorded idle transition yet (e.g. brand-new terminal). */
  windowStartMs: number | null;
  /** Window end (ms): the idle→active transition timestamp, OR now if
   *  the terminal is currently still idle. */
  windowEndMs: number;
  /** Whether the terminal is currently idle. When true the window is
   *  still open + the caller might want to show 'currently away'. */
  stillIdle: boolean;
  missed: MissedMessage[];
};

function canonicalHandle(h: string): string {
  return h.startsWith('@') ? h.toLowerCase() : `@${h.toLowerCase()}`;
}

/**
 * Find the most recent idle window for a terminal. Returns:
 *   - { startMs, endMs, stillIdle: false } when the terminal woke up
 *     (most recent event has new_status != 'idle' AND there's an
 *     earlier 'idle' run).
 *   - { startMs, endMs: now, stillIdle: true } when the terminal is
 *     currently idle.
 *   - null when there's no idle event in the history at all.
 */
function findLatestIdleWindow(
  terminalId: string,
  nowMs: number
): { startMs: number; endMs: number; stillIdle: boolean } | null {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT new_status, changed_at_ms
       FROM chat_agent_status_events
      WHERE terminal_id = ?
   ORDER BY changed_at_ms DESC, id DESC
      LIMIT 200`
  ).all(terminalId) as { new_status: string; changed_at_ms: number }[];
  if (rows.length === 0) return null;
  // Walk newest → oldest. If the latest event is 'idle', the terminal
  // is currently idle and the window is [earliest contiguous idle event,
  // now]. Otherwise scan for the first 'idle' run that ended (i.e. the
  // first wake-up boundary).
  const latest = rows[0];
  if (latest.new_status === 'idle') {
    let earliestIdle = latest.changed_at_ms;
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].new_status !== 'idle') break;
      earliestIdle = rows[i].changed_at_ms;
    }
    return { startMs: earliestIdle, endMs: nowMs, stillIdle: true };
  }
  // Latest is non-idle = wake event. Walk back to find the idle run
  // that immediately preceded it.
  let wakeMs: number | null = latest.changed_at_ms;
  let idleStart: number | null = null;
  let idleEnd: number | null = null;
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.new_status === 'idle') {
      if (idleEnd === null) idleEnd = wakeMs;
      idleStart = row.changed_at_ms;
    } else if (idleStart !== null) {
      // Found the wake → idle → wake sandwich; stop walking.
      break;
    } else {
      // Older non-idle event; keep walking to find an idle run.
      wakeMs = row.changed_at_ms;
    }
  }
  if (idleStart === null || idleEnd === null) return null;
  return { startMs: idleStart, endMs: idleEnd, stillIdle: false };
}

/**
 * Pick the terminal_id for a handle. Returns the most-recently-active
 * terminal if the handle has multiple memberships (it shouldn't, but
 * the schema doesn't forbid it).
 */
function resolveTerminalIdForHandle(handle: string): string | null {
  const db = getIdentityDb();
  const row = db.prepare(
    `SELECT m.terminal_id AS terminal_id
       FROM room_memberships m
       JOIN terminals t ON t.id = m.terminal_id
      WHERE m.handle = ?
   ORDER BY t.updated_at DESC, t.created_at DESC
      LIMIT 1`
  ).get(handle) as { terminal_id: string } | undefined;
  return row?.terminal_id ?? null;
}

/**
 * Read missed messages inside a window for a handle. The handle must
 * be bare-@-mentioned in the body (bracketed mentions don't count,
 * matching the pty-inject-fanout contract).
 */
function listMissedMessagesForHandle(
  handle: string,
  terminalId: string,
  windowStartMs: number,
  windowEndMs: number,
  limit: number
): MissedMessage[] {
  const db = getIdentityDb();
  const roomRows = db.prepare(
    `SELECT DISTINCT room_id FROM room_memberships WHERE terminal_id = ?`
  ).all(terminalId) as { room_id: string }[];
  if (roomRows.length === 0) return [];
  const roomIds = roomRows.map((r) => r.room_id);
  const placeholders = roomIds.map(() => '?').join(', ');
  // Pull every message in the window across this terminal's rooms,
  // then filter to bare-mentions of the handle in-process. Doing the
  // mention parse in SQL would mean stuffing a regex into SQLite or
  // doing a LIKE that misses bracketed-vs-bare nuance; cheaper to do
  // the parse in TS now and revisit if the cost becomes real.
  const startSec = Math.floor(windowStartMs / 1000);
  const endSec = Math.ceil(windowEndMs / 1000);
  const startIso = new Date(startSec * 1000).toISOString();
  const endIso = new Date(endSec * 1000).toISOString();
  const messageRows = db.prepare(
    `SELECT cm.id           AS id,
            cm.room_id      AS room_id,
            cm.author_handle AS author_handle,
            cm.author_display_name AS author_display_name,
            cm.body         AS body,
            cm.posted_at    AS posted_at,
            cr.name         AS room_name
       FROM chat_messages cm
       JOIN chat_rooms cr ON cr.id = cm.room_id
      WHERE cm.room_id IN (${placeholders})
        AND cm.posted_at >= ?
        AND cm.posted_at <= ?
        AND cm.kind = 'human'
        AND cm.author_handle != ?
   ORDER BY cm.posted_at DESC
      LIMIT ?`
  ).all(...roomIds, startIso, endIso, handle, limit * 4) as {
    id: string;
    room_id: string;
    author_handle: string;
    author_display_name: string;
    body: string;
    posted_at: string;
    room_name: string;
  }[];
  const canonical = canonicalHandle(handle);
  const missed: MissedMessage[] = [];
  for (const row of messageRows) {
    const mentions = listBareMentionHandles(row.body).map(canonicalHandle);
    if (!mentions.includes(canonical)) continue;
    missed.push({
      messageId: row.id,
      roomId: row.room_id,
      roomName: row.room_name,
      authorHandle: row.author_handle,
      authorDisplayName: row.author_display_name,
      postedAt: row.posted_at,
      bodyPreview: row.body.length > 200 ? `${row.body.slice(0, 200)}…` : row.body
    });
    if (missed.length >= limit) break;
  }
  return missed;
}

export type DigestForHandleInput = {
  handle: string;
  nowMs?: number;
  limit?: number;
};

export function digestForHandle(input: DigestForHandleInput): AvailabilityDigest {
  const handle = input.handle.startsWith('@') ? input.handle : `@${input.handle}`;
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? 50;
  const terminalId = resolveTerminalIdForHandle(handle);
  if (!terminalId) {
    return { handle, terminalId: null, windowStartMs: null, windowEndMs: nowMs, stillIdle: false, missed: [] };
  }
  const window = findLatestIdleWindow(terminalId, nowMs);
  if (!window) {
    return { handle, terminalId, windowStartMs: null, windowEndMs: nowMs, stillIdle: false, missed: [] };
  }
  const missed = listMissedMessagesForHandle(handle, terminalId, window.startMs, window.endMs, limit);
  return {
    handle,
    terminalId,
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    stillIdle: window.stillIdle,
    missed
  };
}
