/**
 * askStore — Task #130 v3-parity: persisted asks in SQLite.
 *
 * Refactored to use sqliteEntityStore for read-side deduplication.
 * Write operations (open, answer, dismiss) remain entity-specific
 * because validation + business logic vary per operation.
 */

import { getIdentityDb } from './db';
import { createEntityStore } from './sqliteEntityStore';
import { findChatRoomById } from './chatRoomStore';
import { inboxRoomIdFor } from './humanInboxRoomStore';

// Asks-as-pill model (JWPK 2026-05-22): 'merged' is NON-terminal — a merged
// ask still counts toward the askee's response-required pill because the
// merged-into ask will answer it (typically with another question rolled up
// by the Chair premium feature). Only 'answered' and 'dismissed' release
// the pill.
export type AskStatus = 'open' | 'answered' | 'dismissed' | 'merged' | 'deferred';

/** Statuses that keep the askee's response-required pill alive. */
export const RESPONSE_REQUIRED_STATUSES: readonly AskStatus[] = ['open', 'merged', 'deferred'];

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
  return listOrdered(
    "room_id = ? AND status IN ('open','deferred')",
    'opened_at_ms ASC, rowid ASC',
    [roomId]
  );
}

export function listRecentlyAnsweredAsksInRoom(roomId: string, limit = 20): Ask[] {
  return listOrdered(
    "room_id = ? AND status = 'answered'",
    'answered_at_ms DESC, rowid DESC LIMIT ?',
    [roomId, Math.max(0, Math.floor(limit))]
  );
}

export function listAllOpenAsks(): Ask[] {
  return listOrdered("status IN ('open','deferred')", 'opened_at_ms ASC, rowid ASC');
}

export function listAllRecentlyAnsweredAsks(limit = 20): Ask[] {
  return listOrdered(
    "status = 'answered'",
    'answered_at_ms DESC, rowid DESC LIMIT ?',
    [Math.max(0, Math.floor(limit))]
  );
}

/**
 * Asks-as-pill (slice 3): humans get response-required when at least one
 * ask in {open, merged} targets them. Returns ALL such asks (across every
 * room) so a UI can render the pill + the inbox count from a single read.
 */
/**
 * Asks-as-pill (slice 5): roll the SOURCE ask into the INTO ask. The source
 * flips to status='merged' and carries forward the pointer + audit fields;
 * the into ask is left untouched. Because 'merged' is part of
 * RESPONSE_REQUIRED_STATUSES the askee's pill stays lit (the into ask still
 * needs a response — usually itself another question rolled up by the Chair
 * premium feature in the native apps).
 *
 * Validation:
 *   - source must currently be 'open' (don't double-merge or merge an
 *     already-resolved ask; that's an audit-trail violation)
 *   - into must exist and be in {open, merged} (can chain merges into an
 *     umbrella that's been merged itself)
 *   - source and into must share the same targetHandle (you can't merge a
 *     question for @james into a question for @mark — that's silent reassign)
 *   - source.id !== into.id (no self-merge)
 *
 * Returns the updated source ask.
 */
export function mergeAsks(input: {
  sourceAskId: string;
  intoAskId: string;
  mergedByHandle: string;
}): Ask {
  const trimmedMergedBy = input.mergedByHandle.trim();
  if (trimmedMergedBy.length === 0) {
    throw new Error('A mergedByHandle is required to merge an ask.');
  }
  if (input.sourceAskId === input.intoAskId) {
    throw new Error('Cannot merge an ask into itself.');
  }
  const source = findAskById(input.sourceAskId);
  if (!source) throw new Error(`Ask ${input.sourceAskId} not found.`);
  const into = findAskById(input.intoAskId);
  if (!into) throw new Error(`Ask ${input.intoAskId} not found.`);
  if (source.status !== 'open') {
    throw new Error(`Ask ${input.sourceAskId} is already ${source.status}; only open asks can be merged.`);
  }
  if (into.status !== 'open' && into.status !== 'merged') {
    throw new Error(`Cannot merge into ask ${input.intoAskId} (status=${into.status}).`);
  }
  if (source.targetHandle !== into.targetHandle) {
    throw new Error(
      `Cannot merge across target handles (source=${source.targetHandle ?? 'NULL'}, into=${into.targetHandle ?? 'NULL'}).`
    );
  }

  const nowMs = Date.now();
  getIdentityDb().prepare(
    `UPDATE asks SET status = 'merged', merged_into_ask_id = ?, merged_by_handle = ?,
     merged_at_ms = ? WHERE id = ?`
  ).run(input.intoAskId, trimmedMergedBy, nowMs, input.sourceAskId);

  return findAskById(input.sourceAskId)!;
}

export function listResponseRequiredAsksForHandle(targetHandle: string): Ask[] {
  return listOrdered(
    "target_handle = ? AND status IN ('open','merged','deferred')",
    'opened_at_ms ASC, rowid ASC',
    [targetHandle]
  );
}

/**
 * Cheap "is the pill on?" predicate without paying for the full row list.
 * Used by the SSE broadcast on ask-resolve to decide whether the pill
 * should flip back to clear or stay lit (other open asks may remain).
 */
export function hasResponseRequiredAsksForHandle(targetHandle: string): boolean {
  const row = getIdentityDb().prepare(
    `SELECT 1 FROM asks
     WHERE target_handle = ? AND status IN ('open','merged','deferred')
     LIMIT 1`
  ).get(targetHandle) as { 1: number } | undefined;
  return row !== undefined;
}

/**
 * Thrown when openAskInRoom is called with a targetHandle that isn't a
 * `kind=human` member of the room. Asks are the human inbox — agents react
 * to messages via hooks (working/thinking pill), not via asks. This guard
 * is also the security boundary JWPK called out: agents cannot extract a
 * response from a human via a side-channel; the only legal path is an
 * in-room ask that other members can see and audit.
 */
export class AskTargetNotHumanError extends Error {
  targetHandle: string;
  reason: 'not-a-member' | 'is-agent';
  constructor(targetHandle: string, reason: 'not-a-member' | 'is-agent') {
    super(`${targetHandle} cannot receive an ask in this room: ${reason}`);
    this.name = 'AskTargetNotHumanError';
    this.targetHandle = targetHandle;
    this.reason = reason;
  }
}

/**
 * Thrown when an asker tries to open an ask targeting a human they have NO
 * shared context with — no shared chat room AND no terminal-ownership
 * relationship. Per-human inbox model JWPK 2026-05-22: this is the
 * boundary that stops cold-email-style asks from strangers.
 */
export class AskerNotInInboxError extends Error {
  askerHandle: string;
  targetHandle: string;
  constructor(askerHandle: string, targetHandle: string) {
    super(`${askerHandle} cannot ask ${targetHandle}: no shared room or owned terminal grants inbox access.`);
    this.name = 'AskerNotInInboxError';
    this.askerHandle = askerHandle;
    this.targetHandle = targetHandle;
  }
}

export function openAskInRoom(input: {
  roomId: string;
  openedByHandle: string;
  openedByDisplayName?: string;
  /** The human handle being asked. Required when present; the asks-as-pill
   *  model only addresses humans, so callers should pass this on the fanout
   *  + CLI paths. Older callers (Task #130 v3-parity manual asks) may omit
   *  while we migrate them — those rows persist with target_handle NULL and
   *  show up as room-broadcast asks in the inbox until they're closed. */
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

  if (targetForRow !== null) {
    const room = findChatRoomById(trimmedRoomId);
    if (!room) throw new Error(`Cannot open ask for unknown room ${trimmedRoomId}.`);
    // Per-human inbox (JWPK 2026-05-22): the askee no longer needs to be
    // a member of the originating room — the asker just needs inbox
    // access. Look up the target's kind from any source (room membership
    // OR the inbox room itself; an inbox room's owner is always human).
    let targetKind: 'human' | 'agent' | null = null;
    const memberInRoom = room.members.find((member) => member.handle === targetForRow);
    if (memberInRoom) {
      targetKind = memberInRoom.kind;
    } else {
      const inboxRow = getIdentityDb().prepare(
        `SELECT kind FROM chat_room_members WHERE handle = ? AND kind = 'human' LIMIT 1`
      ).get(targetForRow) as { kind: 'human' | 'agent' } | undefined;
      if (inboxRow) targetKind = inboxRow.kind;
    }
    if (targetKind === null) throw new AskTargetNotHumanError(targetForRow, 'not-a-member');
    if (targetKind !== 'human') throw new AskTargetNotHumanError(targetForRow, 'is-agent');

    // Inbox-membership check: the asker must be in the askee's inbox,
    // UNLESS the asker is the askee (you can always ask yourself) OR they
    // share the originating room (the @-mention fanout path proves this
    // implicitly). The inbox check is the security boundary that stops
    // strangers from cold-emailing.
    if (trimmedHandle !== targetForRow) {
      const askerInRoom = room.members.some((member) => member.handle === trimmedHandle);
      if (!askerInRoom) {
        const inboxId = inboxRoomIdFor(targetForRow);
        const askerInInbox = getIdentityDb().prepare(
          `SELECT 1 FROM chat_room_members WHERE room_id = ? AND handle = ? LIMIT 1`
        ).get(inboxId, trimmedHandle);
        if (!askerInInbox) {
          throw new AskerNotInInboxError(trimmedHandle, targetForRow);
        }
      }
    }
  }

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

export function deferAsk(input: {
  askId: string;
  deferredByHandle: string;
}): Ask {
  const trimmedHandle = input.deferredByHandle.trim();
  if (trimmedHandle.length === 0) throw new Error('A deferredByHandle is required to defer an ask.');
  const ask = findAskById(input.askId);
  if (!ask) throw new Error(`Ask ${input.askId} not found.`);
  if (ask.status !== 'open') throw new Error(`Ask ${input.askId} is already ${ask.status}.`);

  getIdentityDb().prepare(
    `UPDATE asks SET status = 'deferred' WHERE id = ?`
  ).run(input.askId);

  return findAskById(input.askId)!;
}

export function resetAskStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM ask_candidates`).run();
  getIdentityDb().prepare(`DELETE FROM asks`).run();
}
