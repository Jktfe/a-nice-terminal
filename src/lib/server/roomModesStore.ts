/**
 * roomModesStore — per-room mode (brainstorm | heads-down | closed) per the
 * room-mode design contract 2026-05-13 (M3.b.4).
 *
 * Schema (see ./db.ts):
 *   chat_room_modes(room_id PK, mode, set_by, set_at)          ← current
 *   chat_room_mode_history(id, room_id, mode, previous_mode,   ← append-only
 *                          set_by, set_at)                       audit log
 *
 * Behaviour:
 *   - getRoomMode(roomId) defaults to 'brainstorm' if no row exists.
 *   - setRoomMode({roomId, mode, set_by}) writes BOTH tables in one
 *     transaction so audit history can never drift from current state.
 *   - listModeHistory(roomId, limit?) returns newest-first.
 *
 * No fanout / no HTTP / no PTY here — this store is the persistence layer.
 */
import { getIdentityDb } from './db';

export type RoomMode = 'brainstorm' | 'heads-down' | 'closed';

export const ALLOWED_ROOM_MODES: readonly RoomMode[] = [
  'brainstorm',
  'heads-down',
  'closed'
] as const;

export function isAllowedRoomMode(candidate: unknown): candidate is RoomMode {
  return typeof candidate === 'string'
    && (ALLOWED_ROOM_MODES as readonly string[]).includes(candidate);
}

export type RoomModeRow = {
  room_id: string;
  mode: RoomMode;
  set_by: string | null;
  set_at: number | null;
};

export type RoomModeHistoryRow = {
  id: number;
  room_id: string;
  mode: RoomMode;
  previous_mode: RoomMode | null;
  set_by: string | null;
  set_at: number;
};

export type SetRoomModeInput = {
  roomId: string;
  mode: RoomMode;
  set_by: string | null;
};

const DEFAULT_ROOM_MODE: RoomMode = 'brainstorm';

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function getRoomMode(roomId: string): RoomMode {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT mode FROM chat_room_modes WHERE room_id = ?`)
    .get(roomId) as { mode: RoomMode } | undefined;
  return row?.mode ?? DEFAULT_ROOM_MODE;
}

export function getRoomModeRow(roomId: string): RoomModeRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT room_id, mode, set_by, set_at FROM chat_room_modes WHERE room_id = ?`)
    .get(roomId) as RoomModeRow | undefined;
  return row ?? null;
}

export function setRoomMode(input: SetRoomModeInput): RoomModeRow {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const writeBothTables = db.transaction((args: SetRoomModeInput & { now: number }) => {
    const previousRow = db
      .prepare(`SELECT mode FROM chat_room_modes WHERE room_id = ?`)
      .get(args.roomId) as { mode: RoomMode } | undefined;
    const previousMode = previousRow?.mode ?? null;

    db.prepare(`INSERT INTO chat_room_modes (room_id, mode, set_by, set_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(room_id) DO UPDATE SET
                  mode = excluded.mode,
                  set_by = excluded.set_by,
                  set_at = excluded.set_at`).run(
      args.roomId, args.mode, args.set_by, args.now
    );

    db.prepare(`INSERT INTO chat_room_mode_history
                  (room_id, mode, previous_mode, set_by, set_at)
                VALUES (?, ?, ?, ?, ?)`).run(
      args.roomId, args.mode, previousMode, args.set_by, args.now
    );
  });
  writeBothTables({ ...input, now });
  return {
    room_id: input.roomId,
    mode: input.mode,
    set_by: input.set_by,
    set_at: now
  };
}

export function listModeHistory(roomId: string, limit?: number): RoomModeHistoryRow[] {
  const db = getIdentityDb();
  const safeLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : null;
  if (safeLimit === null) {
    return db
      .prepare(`SELECT id, room_id, mode, previous_mode, set_by, set_at
                FROM chat_room_mode_history
                WHERE room_id = ?
                ORDER BY set_at DESC, id DESC`)
      .all(roomId) as RoomModeHistoryRow[];
  }
  return db
    .prepare(`SELECT id, room_id, mode, previous_mode, set_by, set_at
              FROM chat_room_mode_history
              WHERE room_id = ?
              ORDER BY set_at DESC, id DESC
              LIMIT ?`)
    .all(roomId, safeLimit) as RoomModeHistoryRow[];
}
