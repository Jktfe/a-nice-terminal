/**
 * membershipStore — THE clean membership table, point 2 of the JWPK spec:
 *
 *   MEMBERSHIP = ONE row: (room_id, handle, session_id).
 *   "Handle Y in Room X resolves to Session Z." That is the entire table.
 *
 * Deliberately NOT in this table (the spaghetti this replaces):
 *   - no terminal_id (identity never routes through a terminal — spec point 3)
 *   - no display columns / kind / name (those live elsewhere)
 *   - no revoked_at_ms soft-delete split. Removal is a DELETE of the row.
 *
 * All operations key by HANDLE. session_id is what the handle currently
 * resolves to (the durable ant_sessions id), never a terminal/pid.
 *
 * NEW standalone store built to be cut over to. Does NOT touch the legacy
 * room_memberships / memberships / chat_room_members tables. Self-contained
 * table init (roomPolicyStore pattern). The table name `room_membership`
 * (singular) is distinct from the legacy `room_memberships` (plural), so the
 * two coexist during the build and there is no schema collision.
 */

import { getIdentityDb } from './db';

export type Membership = {
  room_id: string;
  handle: string;
  /** The durable session the handle resolves to in this room. May be NULL when
   *  a membership exists but its session is not (yet) known — e.g. a legacy
   *  backfill row whose terminal had no resolvable session. */
  session_id: string | null;
  created_at_ms: number;
};

type MembershipRow = {
  room_id: string;
  handle: string;
  session_id: string | null;
  created_at_ms: number;
};

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_membership (
      room_id       TEXT NOT NULL,
      handle        TEXT NOT NULL,
      session_id    TEXT,
      created_at_ms INTEGER NOT NULL,
      UNIQUE (room_id, handle)
    );
    CREATE INDEX IF NOT EXISTS idx_room_membership_room ON room_membership (room_id);
    CREATE INDEX IF NOT EXISTS idx_room_membership_handle ON room_membership (handle);
  `);
}

function rowToMembership(r: MembershipRow): Membership {
  return {
    room_id: r.room_id,
    handle: r.handle,
    session_id: r.session_id,
    created_at_ms: r.created_at_ms
  };
}

/**
 * Add or update a member. Upsert on (room_id, handle): re-adding the same
 * handle in the same room updates the session it resolves to (the durable
 * session may change across rebinds), preserving the original created_at_ms.
 */
export function addMember(
  roomId: string,
  handle: string,
  sessionId: string | null,
  db = getIdentityDb()
): Membership {
  ensureTable(db);
  const now = Date.now();
  db.prepare(
    `INSERT INTO room_membership (room_id, handle, session_id, created_at_ms)
     VALUES (@room_id, @handle, @session_id, @created_at_ms)
     ON CONFLICT (room_id, handle) DO UPDATE SET session_id = excluded.session_id`
  ).run({ room_id: roomId, handle, session_id: sessionId, created_at_ms: now });
  const row = db
    .prepare(`SELECT * FROM room_membership WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as MembershipRow;
  return rowToMembership(row);
}

/** Remove a member — a hard DELETE of the row (no soft-revoke). Returns true
 *  if a row was removed. */
export function removeMember(roomId: string, handle: string, db = getIdentityDb()): boolean {
  ensureTable(db);
  const res = db.prepare(`DELETE FROM room_membership WHERE room_id = ? AND handle = ?`).run(roomId, handle);
  return res.changes > 0;
}

/** All members of a room, oldest first. */
export function listMembers(roomId: string, db = getIdentityDb()): Membership[] {
  ensureTable(db);
  const rows = db
    .prepare(`SELECT * FROM room_membership WHERE room_id = ? ORDER BY created_at_ms ASC, handle ASC`)
    .all(roomId) as MembershipRow[];
  return rows.map(rowToMembership);
}

/** Resolve the session a handle currently maps to in a room. Returns the
 *  session_id (which may itself be null if unknown), or null if the handle is
 *  not a member of the room. Use isMember to disambiguate "not a member" from
 *  "member with no session". */
export function resolveMember(roomId: string, handle: string, db = getIdentityDb()): string | null {
  ensureTable(db);
  const row = db
    .prepare(`SELECT session_id FROM room_membership WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as { session_id: string | null } | undefined;
  return row ? row.session_id : null;
}

/** Whether the handle is a member of the room (regardless of session_id). */
export function isMember(roomId: string, handle: string, db = getIdentityDb()): boolean {
  ensureTable(db);
  const row = db
    .prepare(`SELECT 1 FROM room_membership WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as { 1: number } | undefined;
  return row !== undefined;
}
