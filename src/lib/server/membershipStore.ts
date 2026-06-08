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

/**
 * Browser sessions are minted per-room as ephemeral auth artifacts and the
 * legacy room_memberships table carries one synthetic `@browser-bs_<hex>` row
 * per session (715+ live). They are NOT durable members: the live dashboard
 * read (v0.2 memberships JOIN agents) hides them because they have no agent
 * record. The clean roster must match — so a `@browser-bs_` handle is never a
 * member of room_membership. Canonical predicate, used at every entry to the
 * clean roster (dual-write, backfill, and the consistency-iterator the proof
 * reads), so the clean table can never be polluted by a browser session.
 */
export function isDurableMemberHandle(handle: string): boolean {
  return !handle.trim().toLowerCase().startsWith('@browser-bs_');
}

export function durableMemberWhereClause(column = 'handle'): string {
  return `lower(${column}) NOT LIKE '@browser-bs\\_%' ESCAPE '\\'`;
}

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
  // R3 (2026-06-05): the resolved durable identity the roster backfill writes
  // (agent:<id> / session:<id> / lease:<id> / operator:<h> / handle:<...>), so
  // the lossless+injective proof verifies the PERSISTED identity off disk rather
  // than re-deriving it. Additive ALTER, guarded for existing tables.
  const hasIdentityKey = (db.prepare(`PRAGMA table_info(room_membership)`).all() as Array<{ name: string }>).some(
    (c) => c.name === 'identity_key'
  );
  if (!hasIdentityKey) {
    db.exec(`ALTER TABLE room_membership ADD COLUMN identity_key TEXT`);
  }
}

/**
 * Record the resolved canonical identity for an existing membership row. Kept
 * SEPARATE from addMember so the membership hot path (gate + register) is
 * untouched. Only writes when the row exists; never creates one.
 */
export function setMemberIdentityKey(
  roomId: string,
  handle: string,
  identityKey: string,
  db = getIdentityDb()
): void {
  ensureTable(db);
  db.prepare(`UPDATE room_membership SET identity_key = ? WHERE room_id = ? AND handle = ?`).run(
    identityKey,
    roomId,
    handle
  );
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
 * Add or update a member. Upsert on (room_id, handle), preserving the original
 * created_at_ms.
 *
 * HANDLE-HIJACK GUARD (security): a held handle must NOT be silently stolen by
 * a different session. On conflict we only adopt the incoming session_id when
 * the incumbent claim is UNOWNED — i.e. its session_id is NULL (a legacy
 * backfill row) — or when it is the SAME session re-adding itself (idempotent
 * rebind / heartbeat). When a DIFFERENT, non-null session already owns the
 * handle, the existing claim is left untouched: a second session's addMember
 * is a no-op on the incumbent's session_id. This closes the hole where any
 * session could re-add e.g. @JWPK and quietly take over the handle.
 */
export function addMember(
  roomId: string,
  handle: string,
  sessionId: string | null,
  db = getIdentityDb()
): Membership {
  ensureTable(db);
  if (!isDurableMemberHandle(handle)) {
    throw new Error(`Cannot add synthetic browser-session handle ${handle} to room_membership.`);
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO room_membership (room_id, handle, session_id, created_at_ms)
     VALUES (@room_id, @handle, @session_id, @created_at_ms)
     ON CONFLICT (room_id, handle) DO UPDATE SET session_id = excluded.session_id
       WHERE room_membership.session_id IS NULL
          OR room_membership.session_id = excluded.session_id`
  ).run({ room_id: roomId, handle, session_id: sessionId, created_at_ms: now });
  const row = db
    .prepare(`SELECT * FROM room_membership WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as MembershipRow;
  return rowToMembership(row);
}

/**
 * Register-time self-heal for an EXISTING membership row.
 *
 * This is deliberately separate from addMember: ordinary callers must not be
 * able to overwrite a non-null session_id. Registration, however, can prove a
 * reclaim is safe by using the same stale-holder predicate as the clean lease
 * repair. If the incumbent session is null, already the incoming session, or
 * proven stale/unresolvable, the canonical membership row is re-keyed to the
 * durable session token the caller just minted.
 */
export function rebindMemberSessionIfStale(
  roomId: string,
  handle: string,
  sessionId: string,
  isCurrentSessionStale: (currentSessionId: string) => boolean,
  db = getIdentityDb()
): Membership | null {
  ensureTable(db);
  if (!isDurableMemberHandle(handle)) return null;
  const row = db
    .prepare(`SELECT * FROM room_membership WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as MembershipRow | undefined;
  if (!row) return null;
  if (
    row.session_id === null ||
    row.session_id === sessionId ||
    isCurrentSessionStale(row.session_id)
  ) {
    db.prepare(`UPDATE room_membership SET session_id = ? WHERE room_id = ? AND handle = ?`).run(
      sessionId,
      roomId,
      handle
    );
  }
  const next = db
    .prepare(`SELECT * FROM room_membership WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as MembershipRow;
  return rowToMembership(next);
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
    .prepare(
      `SELECT * FROM room_membership
        WHERE room_id = ? AND ${durableMemberWhereClause()}
        ORDER BY created_at_ms ASC, handle ASC`
    )
    .all(roomId) as MembershipRow[];
  return rows.map(rowToMembership);
}

/** Resolve the session a handle currently maps to in a room. Returns the
 *  session_id (which may itself be null if unknown), or null if the handle is
 *  not a member of the room. Use isMember to disambiguate "not a member" from
 *  "member with no session". */
export function resolveMember(roomId: string, handle: string, db = getIdentityDb()): string | null {
  ensureTable(db);
  if (!isDurableMemberHandle(handle)) return null;
  const row = db
    .prepare(`SELECT session_id FROM room_membership WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as { session_id: string | null } | undefined;
  return row ? row.session_id : null;
}

/** Whether the handle is a member of the room (regardless of session_id). */
export function isMember(roomId: string, handle: string, db = getIdentityDb()): boolean {
  ensureTable(db);
  if (!isDurableMemberHandle(handle)) return false;
  const row = db
    .prepare(`SELECT 1 FROM room_membership WHERE room_id = ? AND handle = ?`)
    .get(roomId, handle) as { 1: number } | undefined;
  return row !== undefined;
}

/**
 * Every room this handle already belongs to. Used by register's Part 2 lease
 * self-heal to re-key the clean (gate-read) lease to the real token for the
 * agent's EXISTING memberships only — never to auto-join new rooms.
 */
export function listRoomsForHandle(handle: string, db = getIdentityDb()): string[] {
  ensureTable(db);
  if (!isDurableMemberHandle(handle)) return [];
  const rows = db
    .prepare(`SELECT DISTINCT room_id FROM room_membership WHERE handle = ?`)
    .all(handle) as Array<{ room_id: string }>;
  return rows.map((r) => r.room_id);
}
