/**
 * Per-room handle aliases — SQLite-backed, multi-per-handle.
 *
 * PID-as-identity model (JWPK msg_n2cyrel4u5, 2026-05-21):
 *   - A member's "global handle" is the immutable identity hook inside a room.
 *   - Aliases are pure display. Stack as many as you want per (room × handle);
 *     they all resolve back to the same identity at routing time.
 *   - UNIQUE(room_id, alias): within a single room two members cannot share an
 *     alias text, same constraint the bare global handles already obey
 *     (room_memberships.UNIQUE(room_id, handle)). Keeps @-mention routing
 *     deterministic.
 *   - The default "what does this member look like" alias is the most-recently
 *     added one (findAliasForHandleInRoom). All aliases are listable for the
 *     identity-table endpoint that lets agents disambiguate bare-name body text.
 *
 * Was an in-mem Map until 2026-05-21 — evaporated every kickstart. Persisted
 * here so aliases survive restarts the same way memberships do.
 */

import { findChatRoomById } from './chatRoomStore';
import { getIdentityDb } from './db';

export type RoomAliasEntry = {
  roomId: string;
  globalHandle: string;
  alias: string;
  setBy: string | null;
  setAt: string;
};

type AliasRow = {
  room_id: string;
  global_handle: string;
  alias: string;
  set_by: string | null;
  set_at_ms: number;
};

function rowToEntry(row: AliasRow): RoomAliasEntry {
  return {
    roomId: row.room_id,
    globalHandle: row.global_handle,
    alias: row.alias,
    setBy: row.set_by,
    setAt: new Date(row.set_at_ms).toISOString()
  };
}

function normaliseToAtHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@')) return trimmed;
  return `@${trimmed}`;
}

function isMemberOfRoom(roomId: string, globalHandle: string): boolean {
  const room = findChatRoomById(roomId);
  if (!room) return false;
  return room.members.some((member) => member.handle === globalHandle);
}

/** Most-recently-added alias for this handle in this room, or undefined. */
export function findAliasForHandleInRoom(
  roomId: string,
  globalHandle: string
): string | undefined {
  const row = getIdentityDb()
    .prepare<[string, string], AliasRow>(
      `SELECT room_id, global_handle, alias, set_by, set_at_ms
       FROM chat_room_aliases
       WHERE room_id = ? AND global_handle = ?
       ORDER BY set_at_ms DESC, id DESC
       LIMIT 1`
    )
    .get(roomId, globalHandle);
  return row?.alias;
}

/**
 * Every alias for this handle in this room, newest first. The identity-table
 * endpoint uses this so agents seeing bare body text ("the Claude") can map a
 * name back to one of the active aliases.
 */
export function listAliasesForHandleInRoom(
  roomId: string,
  globalHandle: string
): RoomAliasEntry[] {
  return getIdentityDb()
    .prepare<[string, string], AliasRow>(
      `SELECT room_id, global_handle, alias, set_by, set_at_ms
       FROM chat_room_aliases
       WHERE room_id = ? AND global_handle = ?
       ORDER BY set_at_ms DESC, id DESC`
    )
    .all(roomId, globalHandle)
    .map(rowToEntry);
}

export function listAliasesForRoom(roomId: string): RoomAliasEntry[] {
  return getIdentityDb()
    .prepare<[string], AliasRow>(
      `SELECT room_id, global_handle, alias, set_by, set_at_ms
       FROM chat_room_aliases
       WHERE room_id = ?
       ORDER BY set_at_ms DESC, id DESC`
    )
    .all(roomId)
    .map(rowToEntry);
}

/**
 * Reverse lookup: which global handle does this alias text point at?
 *
 * Resolution order:
 *   1. SQLite alias row whose `alias` equals the candidate text → owning handle.
 *   2. Otherwise the candidate IS its own global handle (a bare handle that
 *      nobody has aliased is its own canonical form). The caller's downstream
 *      membership filter decides whether the resolved handle actually exists
 *      in the room — we don't gate that here so this stays a pure name
 *      resolver and works equally for the SQLite-backed and in-mem-only
 *      callers.
 */
export function findHandleForAliasInRoom(
  roomId: string,
  aliasText: string
): string {
  const candidate = normaliseToAtHandle(aliasText);
  const row = getIdentityDb()
    .prepare<[string, string], { global_handle: string }>(
      `SELECT global_handle FROM chat_room_aliases
       WHERE room_id = ? AND alias = ? LIMIT 1`
    )
    .get(roomId, candidate);
  return row?.global_handle ?? candidate;
}

/**
 * Returns the global handle that already owns `candidateAlias` in this room,
 * or undefined when nothing collides. The same handle holding the alias
 * already (via ignoreGlobalHandle) is allowed — re-setting is a no-op.
 */
export function findCollisionForAlias(input: {
  roomId: string;
  candidateAlias: string;
  ignoreGlobalHandle?: string;
}): string | undefined {
  const room = findChatRoomById(input.roomId);
  if (!room) return undefined;
  const candidate = normaliseToAtHandle(input.candidateAlias);

  for (const member of room.members) {
    if (member.handle === input.ignoreGlobalHandle) continue;
    if (member.handle === candidate) return member.handle;
  }

  const row = getIdentityDb()
    .prepare<[string, string], { global_handle: string }>(
      `SELECT global_handle FROM chat_room_aliases
       WHERE room_id = ? AND alias = ? LIMIT 1`
    )
    .get(input.roomId, candidate);
  if (!row) return undefined;
  if (row.global_handle === input.ignoreGlobalHandle) return undefined;
  return row.global_handle;
}

/**
 * Add an alias for `globalHandle` in this room. Stacks: previous aliases for
 * the same handle stay in place. No-op when this exact (handle, alias) pair
 * already exists — returns the existing row instead of throwing. Throws
 * RoomAliasCollisionError when the alias is taken by a different handle.
 */
export function setRoomAlias(input: {
  roomId: string;
  globalHandle: string;
  newAlias: string;
  setBy?: string;
}): RoomAliasEntry {
  if (!findChatRoomById(input.roomId)) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }
  if (!isMemberOfRoom(input.roomId, input.globalHandle)) {
    throw new Error(`${input.globalHandle} is not a member of this room.`);
  }

  const trimmedAlias = input.newAlias.trim();
  if (trimmedAlias.length === 0) {
    throw new Error('A room alias cannot be blank.');
  }

  const aliasWithAt = normaliseToAtHandle(trimmedAlias);

  const collidesWith = findCollisionForAlias({
    roomId: input.roomId,
    candidateAlias: aliasWithAt,
    ignoreGlobalHandle: input.globalHandle
  });
  if (collidesWith) {
    throw new RoomAliasCollisionError(aliasWithAt, collidesWith);
  }

  const db = getIdentityDb();
  const existing = db
    .prepare<[string, string, string], AliasRow>(
      `SELECT room_id, global_handle, alias, set_by, set_at_ms
       FROM chat_room_aliases
       WHERE room_id = ? AND global_handle = ? AND alias = ?`
    )
    .get(input.roomId, input.globalHandle, aliasWithAt);
  if (existing) return rowToEntry(existing);

  const nowMs = Date.now();
  db.prepare(
    `INSERT INTO chat_room_aliases (room_id, global_handle, alias, set_by, set_at_ms)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.roomId, input.globalHandle, aliasWithAt, input.setBy ?? null, nowMs);

  return {
    roomId: input.roomId,
    globalHandle: input.globalHandle,
    alias: aliasWithAt,
    setBy: input.setBy ?? null,
    setAt: new Date(nowMs).toISOString()
  };
}

/** Drop ALL aliases this handle owns in this room. Returns true when any row
 *  was removed. Matches DELETE /api/chat-rooms/:roomId/aliases?globalHandle= */
export function removeRoomAlias(input: {
  roomId: string;
  globalHandle: string;
}): boolean {
  const result = getIdentityDb()
    .prepare(`DELETE FROM chat_room_aliases WHERE room_id = ? AND global_handle = ?`)
    .run(input.roomId, input.globalHandle);
  return result.changes > 0;
}

/** Drop a single alias by exact text. Used when the user wants to remove just
 *  one of several stacked aliases without dropping the rest. */
export function removeAliasByText(input: {
  roomId: string;
  alias: string;
}): boolean {
  const aliasWithAt = normaliseToAtHandle(input.alias);
  const result = getIdentityDb()
    .prepare(`DELETE FROM chat_room_aliases WHERE room_id = ? AND alias = ?`)
    .run(input.roomId, aliasWithAt);
  return result.changes > 0;
}

export function resetChatRoomAliasStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM chat_room_aliases`).run();
}

export class RoomAliasCollisionError extends Error {
  alias: string;
  collidesWith: string;

  constructor(alias: string, collidesWith: string) {
    super(`${alias} is already used by ${collidesWith} in this room.`);
    this.name = 'RoomAliasCollisionError';
    this.alias = alias;
    this.collidesWith = collidesWith;
  }
}
