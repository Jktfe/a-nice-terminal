/**
 * askStore — Task #130 v3-parity: persisted asks in SQLite.
 *
 * Previously in-memory Maps; now stored in the asks table so they
 * survive server restarts. Supports open, answer, dismiss, list.
 */

import { getIdentityDb } from './db';

export type AskStatus = 'open' | 'answered' | 'dismissed';

export type Ask = {
  id: string;
  roomId: string;
  openedByHandle: string;
  openedByDisplayName: string;
  title: string;
  body: string;
  status: AskStatus;
  openedAt: string;
  answer?: string;
  answeredByHandle?: string;
  answeredByDisplayName?: string;
  answeredAt?: string;
  dismissedByHandle?: string;
  dismissedByDisplayName?: string;
  dismissedAt?: string;
};

type AskRow = {
  id: string;
  room_id: string;
  opened_by_handle: string;
  opened_by_display_name: string;
  title: string;
  body: string;
  status: string;
  opened_at_ms: number;
  answer: string | null;
  answered_by_handle: string | null;
  answered_by_display_name: string | null;
  answered_at_ms: number | null;
  dismissed_by_handle: string | null;
  dismissed_by_display_name: string | null;
  dismissed_at_ms: number | null;
};

function makeAskId(): string {
  return `ask_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function rowToAsk(row: AskRow): Ask {
  const ask: Ask = {
    id: row.id,
    roomId: row.room_id,
    openedByHandle: row.opened_by_handle,
    openedByDisplayName: row.opened_by_display_name,
    title: row.title,
    body: row.body,
    status: row.status as AskStatus,
    openedAt: msToIso(row.opened_at_ms)
  };
  if (row.answer !== null) {
    ask.answer = row.answer;
    ask.answeredByHandle = row.answered_by_handle ?? undefined;
    ask.answeredByDisplayName = row.answered_by_display_name ?? undefined;
    ask.answeredAt = row.answered_at_ms ? msToIso(row.answered_at_ms) : undefined;
  }
  if (row.dismissed_by_handle !== null) {
    ask.dismissedByHandle = row.dismissed_by_handle;
    ask.dismissedByDisplayName = row.dismissed_by_display_name ?? undefined;
    ask.dismissedAt = row.dismissed_at_ms ? msToIso(row.dismissed_at_ms) : undefined;
  }
  return ask;
}

export function openAskInRoom(input: {
  roomId: string;
  openedByHandle: string;
  openedByDisplayName?: string;
  title: string;
  body: string;
}): Ask {
  const trimmedRoomId = input.roomId.trim();
  if (trimmedRoomId.length === 0) {
    throw new Error('A roomId is required to open an ask.');
  }
  const trimmedHandle = input.openedByHandle.trim();
  if (trimmedHandle.length === 0) {
    throw new Error('An openedByHandle is required to open an ask.');
  }
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    throw new Error('An ask needs a non-blank title.');
  }
  const trimmedBody = input.body.trim();
  if (trimmedBody.length === 0) {
    throw new Error('An ask needs a non-blank body.');
  }

  const id = makeAskId();
  const nowMs = Date.now();
  const openedByDisplayName =
    input.openedByDisplayName?.trim().length
      ? input.openedByDisplayName.trim()
      : trimmedHandle;

  getIdentityDb().prepare(
    `INSERT INTO asks
     (id, room_id, opened_by_handle, opened_by_display_name, title, body, status, opened_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, trimmedRoomId, trimmedHandle, openedByDisplayName, trimmedTitle, trimmedBody, 'open', nowMs);

  return {
    id,
    roomId: trimmedRoomId,
    openedByHandle: trimmedHandle,
    openedByDisplayName,
    title: trimmedTitle,
    body: trimmedBody,
    status: 'open',
    openedAt: msToIso(nowMs)
  };
}

export function listOpenAsksInRoom(roomId: string): Ask[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, opened_by_handle, opened_by_display_name, title, body, status,
              opened_at_ms, answer, answered_by_handle, answered_by_display_name, answered_at_ms,
              dismissed_by_handle, dismissed_by_display_name, dismissed_at_ms
         FROM asks
        WHERE room_id = ? AND status = 'open'
        ORDER BY opened_at_ms ASC, rowid ASC`
    )
    .all(roomId) as AskRow[];
  return rows.map(rowToAsk);
}

export function listRecentlyAnsweredAsksInRoom(roomId: string, limit = 20): Ask[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, opened_by_handle, opened_by_display_name, title, body, status,
              opened_at_ms, answer, answered_by_handle, answered_by_display_name, answered_at_ms,
              dismissed_by_handle, dismissed_by_display_name, dismissed_at_ms
         FROM asks
        WHERE room_id = ? AND status = 'answered'
        ORDER BY answered_at_ms DESC, rowid DESC
        LIMIT ?`
    )
    .all(roomId, Math.max(0, Math.floor(limit))) as AskRow[];
  return rows.map(rowToAsk);
}

export function listAllOpenAsks(): Ask[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, opened_by_handle, opened_by_display_name, title, body, status,
              opened_at_ms, answer, answered_by_handle, answered_by_display_name, answered_at_ms,
              dismissed_by_handle, dismissed_by_display_name, dismissed_at_ms
         FROM asks
        WHERE status = 'open'
        ORDER BY opened_at_ms ASC, rowid ASC`
    )
    .all() as AskRow[];
  return rows.map(rowToAsk);
}

export function listAllRecentlyAnsweredAsks(limit = 20): Ask[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, opened_by_handle, opened_by_display_name, title, body, status,
              opened_at_ms, answer, answered_by_handle, answered_by_display_name, answered_at_ms,
              dismissed_by_handle, dismissed_by_display_name, dismissed_at_ms
         FROM asks
        WHERE status = 'answered'
        ORDER BY answered_at_ms DESC, rowid DESC
        LIMIT ?`
    )
    .all(Math.max(0, Math.floor(limit))) as AskRow[];
  return rows.map(rowToAsk);
}

export function findAskById(askId: string): Ask | undefined {
  const row = getIdentityDb()
    .prepare(
      `SELECT id, room_id, opened_by_handle, opened_by_display_name, title, body, status,
              opened_at_ms, answer, answered_by_handle, answered_by_display_name, answered_at_ms,
              dismissed_by_handle, dismissed_by_display_name, dismissed_at_ms
         FROM asks
        WHERE id = ?`
    )
    .get(askId) as AskRow | undefined;
  return row ? rowToAsk(row) : undefined;
}

export function answerAsk(input: {
  askId: string;
  answeredByHandle: string;
  answeredByDisplayName?: string;
  answer: string;
}): Ask {
  const trimmedAnswer = input.answer.trim();
  if (trimmedAnswer.length === 0) {
    throw new Error('An answer needs at least one non-blank character.');
  }
  const trimmedHandle = input.answeredByHandle.trim();
  if (trimmedHandle.length === 0) {
    throw new Error('An answeredByHandle is required to answer an ask.');
  }
  const ask = findAskById(input.askId);
  if (!ask) {
    throw new Error(`Ask ${input.askId} not found.`);
  }
  if (ask.status !== 'open') {
    throw new Error(`Ask ${input.askId} is already ${ask.status}.`);
  }

  const nowMs = Date.now();
  getIdentityDb().prepare(
    `UPDATE asks
        SET status = 'answered',
            answer = ?,
            answered_by_handle = ?,
            answered_by_display_name = ?,
            answered_at_ms = ?
      WHERE id = ?`
  ).run(
    trimmedAnswer,
    trimmedHandle,
    input.answeredByDisplayName ?? trimmedHandle,
    nowMs,
    input.askId
  );

  return findAskById(input.askId)!;
}

export function dismissAsk(input: {
  askId: string;
  dismissedByHandle: string;
  dismissedByDisplayName?: string;
}): Ask {
  const trimmedHandle = input.dismissedByHandle.trim();
  if (trimmedHandle.length === 0) {
    throw new Error('A dismissedByHandle is required to dismiss an ask.');
  }
  const ask = findAskById(input.askId);
  if (!ask) {
    throw new Error(`Ask ${input.askId} not found.`);
  }
  if (ask.status !== 'open') {
    throw new Error(`Ask ${input.askId} is already ${ask.status}.`);
  }

  const nowMs = Date.now();
  getIdentityDb().prepare(
    `UPDATE asks
        SET status = 'dismissed',
            dismissed_by_handle = ?,
            dismissed_by_display_name = ?,
            dismissed_at_ms = ?
      WHERE id = ?`
  ).run(
    trimmedHandle,
    input.dismissedByDisplayName ?? trimmedHandle,
    nowMs,
    input.askId
  );

  return findAskById(input.askId)!;
}

export function resetAskStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM ask_candidates`).run();
  getIdentityDb().prepare(`DELETE FROM asks`).run();
}
