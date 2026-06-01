/**
 * roomMemberPreferencesStore — per-(room, viewer-handle) UI preferences.
 *
 * The native apps (antios + antchat per eiw05zdurz contract 2026-05-27)
 * need a server-side persistence layer for `pinned`, `muted`, `archived`
 * so a user setting these on iPhone sees them reflected on Mac. The
 * preferences drive sidebar ordering in conjunction with the
 * priorityScore computed in agentVisibilityStore.
 *
 * - `pinned` rooms float above non-pinned regardless of score (client
 *   composes — the server returns the bool, not the final order).
 * - `muted` zeroes the priorityScore at the server side so muted rooms
 *   sort to the bottom by default (still visible unless archived).
 * - `archived` hides the room from the default visibility query; clients
 *   can request archived rooms via an explicit filter.
 *
 * Absent rows = all flags false (the common case). Insert-on-first-set
 * keeps the table small.
 */

import { getIdentityDb } from './db';

export type RoomMemberPreferences = {
  roomId: string;
  handle: string;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  updatedAtMs: number;
};

type RoomMemberPreferencesRow = {
  room_id: string;
  handle: string;
  pinned: number;
  muted: number;
  archived: number;
  updated_at_ms: number;
};

function rowToPreferences(row: RoomMemberPreferencesRow): RoomMemberPreferences {
  return {
    roomId: row.room_id,
    handle: row.handle,
    pinned: row.pinned === 1,
    muted: row.muted === 1,
    archived: row.archived === 1,
    updatedAtMs: row.updated_at_ms
  };
}

const EMPTY_FLAGS = { pinned: false, muted: false, archived: false } as const;

/**
 * Read one viewer's preferences for one room. Returns sensible defaults
 * (all flags false) when no row exists.
 */
export function getRoomMemberPreferences(roomId: string, handle: string): RoomMemberPreferences {
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT room_id, handle, pinned, muted, archived, updated_at_ms
         FROM room_member_preferences
        WHERE room_id = ? AND handle = ?`
    )
    .get(roomId, handle) as RoomMemberPreferencesRow | undefined;
  if (row) return rowToPreferences(row);
  return { roomId, handle, ...EMPTY_FLAGS, updatedAtMs: 0 };
}

/**
 * Read all preferences for a viewer across rooms. Used by visibility
 * to bulk-merge flags onto the room list without N round-trips.
 */
export function listRoomMemberPreferencesForHandle(handle: string): RoomMemberPreferences[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT room_id, handle, pinned, muted, archived, updated_at_ms
         FROM room_member_preferences
        WHERE handle = ?`
    )
    .all(handle) as RoomMemberPreferencesRow[];
  return rows.map(rowToPreferences);
}

type SetPreferencesInput = {
  roomId: string;
  handle: string;
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
};

/**
 * Idempotent upsert. Only the flags supplied in `input` are written;
 * unspecified flags retain their existing value (or default-false if
 * the row didn't exist). Returns the canonical row after the write.
 */
export function setRoomMemberPreferences(input: SetPreferencesInput): RoomMemberPreferences {
  const trimmedRoomId = input.roomId.trim();
  const trimmedHandle = input.handle.trim();
  if (trimmedRoomId.length === 0) {
    throw new Error('roomId is required.');
  }
  if (trimmedHandle.length === 0) {
    throw new Error('handle is required.');
  }
  const current = getRoomMemberPreferences(trimmedRoomId, trimmedHandle);
  const next = {
    pinned: input.pinned ?? current.pinned,
    muted: input.muted ?? current.muted,
    archived: input.archived ?? current.archived
  };
  const nowMs = Date.now();
  const db = getIdentityDb();
  db
    .prepare(
      `INSERT INTO room_member_preferences (room_id, handle, pinned, muted, archived, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_id, handle) DO UPDATE SET
         pinned = excluded.pinned,
         muted = excluded.muted,
         archived = excluded.archived,
         updated_at_ms = excluded.updated_at_ms`
    )
    .run(
      trimmedRoomId,
      trimmedHandle,
      next.pinned ? 1 : 0,
      next.muted ? 1 : 0,
      next.archived ? 1 : 0,
      nowMs
    );
  return { roomId: trimmedRoomId, handle: trimmedHandle, ...next, updatedAtMs: nowMs };
}

export function resetRoomMemberPreferencesStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM room_member_preferences').run();
}
