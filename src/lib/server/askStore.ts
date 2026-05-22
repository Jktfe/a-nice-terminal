/**
 * askStore — Task #130 v3-parity: persisted asks in SQLite.
 *
 * Refactored to use sqliteEntityStore for read-side deduplication.
 * Write operations (open, answer, dismiss) remain entity-specific
 * because validation + business logic vary per operation.
 */

import { getIdentityDb } from './db';
import { createEntityStore } from './sqliteEntityStore';

// Asks-as-pill model (JWPK 2026-05-22): 'merged' is NON-terminal — a merged
// ask still counts toward the askee's response-required pill because the
// merged-into ask will answer it (typically with another question rolled up
// by the Chair premium feature). Only 'answered' and 'dismissed' release
// the pill.
export type AskStatus = 'open' | 'answered' | 'dismissed' | 'merged';

/** Statuses that keep the askee's response-required pill alive. */
export const RESPONSE_REQUIRED_STATUSES: readonly AskStatus[] = ['open', 'merged'];

export type Ask = {
  id: string;
  roomId: string;
  openedByHandle: string;
  openedByDisplayName: string;
  /** The human handle the ask is targeting. Null on legacy rows pre-2026-05-22. */
  targetHandle?: string;
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
  mergedIntoAskId?: string;
  mergedByHandle?: string;
  mergedAt?: string;
};

type AskRow = {
  id: string;
  room_id: string;
  opened_by_handle: string;
  opened_by_display_name: string;
  target_handle: string | null;
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
  merged_into_ask_id: string | null;
  merged_by_handle: string | null;
  merged_at_ms: number | null;
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
  if (row.target_handle !== null) ask.targetHandle = row.target_handle;
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
  if (row.merged_into_ask_id !== null) {
    ask.mergedIntoAskId = row.merged_into_ask_id;
    ask.mergedByHandle = row.merged_by_handle ?? undefined;
    ask.mergedAt = row.merged_at_ms ? msToIso(row.merged_at_ms) : undefined;
  }
  return ask;
}

const ASK_COLUMNS = [
  'id', 'room_id', 'opened_by_handle', 'opened_by_display_name', 'target_handle',
  'title', 'body', 'status', 'opened_at_ms',
  'answer', 'answered_by_handle', 'answered_by_display_name', 'answered_at_ms',
  'dismissed_by_handle', 'dismissed_by_display_name', 'dismissed_at_ms',
  'merged_into_ask_id', 'merged_by_handle', 'merged_at_ms'
];

const { get: getAskRaw, listOrdered } = createEntityStore<Ask, AskRow>({
  table: 'asks',
  columns: ASK_COLUMNS,
  rowToDomain: rowToAsk
});

// Re-export get with the old name for backward compatibility
export function findAskById(askId: string): Ask | undefined {
  return getAskRaw(askId) ?? undefined;
}

export function listOpenAsksInRoom(roomId: string): Ask[] {
  return listOrdered("room_id = ? AND status = 'open'", 'opened_at_ms ASC, rowid ASC', [roomId]);
}

export function listRecentlyAnsweredAsksInRoom(roomId: string, limit = 20): Ask[] {
  return listOrdered(
    "room_id = ? AND status = 'answered'",
    'answered_at_ms DESC, rowid DESC LIMIT ?',
    [roomId, Math.max(0, Math.floor(limit))]
  );
}

export function listAllOpenAsks(): Ask[] {
  return listOrdered("status = 'open'", 'opened_at_ms ASC, rowid ASC');
}

export function listAllRecentlyAnsweredAsks(limit = 20): Ask[] {
  return listOrdered(
    "status = 'answered'",
    'answered_at_ms DESC, rowid DESC LIMIT ?',
    [Math.max(0, Math.floor(limit))]
  );
}

export function openAskInRoom(input: {
  roomId: string;
  openedByHandle: string;
  openedByDisplayName?: string;
  /** The human handle being asked. Optional in slice 1 schema migration so
   *  legacy in-flight calls don't break; slice 2 turns this into a required
   *  field at the call sites + enforces human-membership. */
  targetHandle?: string;
  title: string;
  body: string;
}): Ask {
  const trimmedRoomId = input.roomId.trim();
  if (trimmedRoomId.length === 0) throw new Error('A roomId is required to open an ask.');
  const trimmedHandle = input.openedByHandle.trim();
  if (trimmedHandle.length === 0) throw new Error('An openedByHandle is required to open an ask.');
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) throw new Error('An ask needs a non-blank title.');
  const trimmedBody = input.body.trim();
  if (trimmedBody.length === 0) throw new Error('An ask needs a non-blank body.');
  const trimmedTarget = input.targetHandle?.trim();
  const targetForRow = trimmedTarget && trimmedTarget.length > 0 ? trimmedTarget : null;

  const id = makeAskId();
  const nowMs = Date.now();
  const openedByDisplayName = input.openedByDisplayName?.trim().length
    ? input.openedByDisplayName.trim()
    : trimmedHandle;

  getIdentityDb().prepare(
    `INSERT INTO asks
     (id, room_id, opened_by_handle, opened_by_display_name, target_handle,
      title, body, status, opened_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, trimmedRoomId, trimmedHandle, openedByDisplayName, targetForRow,
    trimmedTitle, trimmedBody, 'open', nowMs
  );

  const ask: Ask = {
    id, roomId: trimmedRoomId, openedByHandle: trimmedHandle, openedByDisplayName,
    title: trimmedTitle, body: trimmedBody, status: 'open', openedAt: msToIso(nowMs)
  };
  if (targetForRow !== null) ask.targetHandle = targetForRow;
  return ask;
}

export function answerAsk(input: {
  askId: string;
  answeredByHandle: string;
  answeredByDisplayName?: string;
  answer: string;
}): Ask {
  const trimmedAnswer = input.answer.trim();
  if (trimmedAnswer.length === 0) throw new Error('An answer needs at least one non-blank character.');
  const trimmedHandle = input.answeredByHandle.trim();
  if (trimmedHandle.length === 0) throw new Error('An answeredByHandle is required to answer an ask.');
  const ask = findAskById(input.askId);
  if (!ask) throw new Error(`Ask ${input.askId} not found.`);
  if (ask.status !== 'open') throw new Error(`Ask ${input.askId} is already ${ask.status}.`);

  const nowMs = Date.now();
  getIdentityDb().prepare(
    `UPDATE asks SET status = 'answered', answer = ?, answered_by_handle = ?,
     answered_by_display_name = ?, answered_at_ms = ? WHERE id = ?`
  ).run(trimmedAnswer, trimmedHandle, input.answeredByDisplayName ?? trimmedHandle, nowMs, input.askId);

  return findAskById(input.askId)!;
}

export function dismissAsk(input: {
  askId: string;
  dismissedByHandle: string;
  dismissedByDisplayName?: string;
}): Ask {
  const trimmedHandle = input.dismissedByHandle.trim();
  if (trimmedHandle.length === 0) throw new Error('A dismissedByHandle is required to dismiss an ask.');
  const ask = findAskById(input.askId);
  if (!ask) throw new Error(`Ask ${input.askId} not found.`);
  if (ask.status !== 'open') throw new Error(`Ask ${input.askId} is already ${ask.status}.`);

  const nowMs = Date.now();
  getIdentityDb().prepare(
    `UPDATE asks SET status = 'dismissed', dismissed_by_handle = ?,
     dismissed_by_display_name = ?, dismissed_at_ms = ? WHERE id = ?`
  ).run(trimmedHandle, input.dismissedByDisplayName ?? trimmedHandle, nowMs, input.askId);

  return findAskById(input.askId)!;
}

export function resetAskStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM ask_candidates`).run();
  getIdentityDb().prepare(`DELETE FROM asks`).run();
}
