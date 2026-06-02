/**
 * roomHandleLeaseStore — per-room handle leases for the Simplify & Harden
 * model (plan room-identity-stage-full-delivery-2026-06-02, lane A).
 *
 * A session LEASES a handle (or alias) within a room. The lease — not the
 * terminal binding — is what makes a handle resolve to an identity:
 *   @handle  --(active lease in room)-->  session ID  -->  delivery adapter
 *
 * Invariants (JWPK's model + slide 5/7):
 *   - One ACTIVE handle per (room) — enforced by a partial unique index.
 *   - A session may hold DIFFERENT handles across DIFFERENT rooms
 *     (@speedy here, @architect there) — uniqueness is per-room, not global.
 *   - Releasing a lease frees the handle for re-lease by anyone.
 *   - Historical attribution survives reuse: leases are never deleted, only
 *     closed (released_at_ms), so a post's author session can always be
 *     mapped back even after the handle changes hands (the @name#1 render
 *     rule lives on top of this — author lane).
 *   - Restart-safe: leases are durable rows keyed by session ID, so a pid
 *     drift / day-roll keeps a session's leases intact.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type HandleLease = {
  id: string;
  room_id: string;
  /** Stored normalised WITHOUT the leading '@'; compare case-insensitively. */
  handle: string;
  session_id: string;
  leased_at_ms: number;
  /** NULL while active; set when released (handle becomes available). */
  released_at_ms: number | null;
};

type LeaseRow = {
  id: string;
  room_id: string;
  handle: string;
  session_id: string;
  leased_at_ms: number;
  released_at_ms: number | null;
};

/** Normalise a handle for storage/compare: strip a leading '@', trim,
 *  lowercase. Display casing is a separate concern (the post snapshot). */
export function normaliseHandle(handle: string): string {
  return handle.replace(/^@+/, '').trim().toLowerCase();
}

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_handle_leases (
      id             TEXT PRIMARY KEY,
      room_id        TEXT NOT NULL,
      handle         TEXT NOT NULL,
      session_id     TEXT NOT NULL,
      leased_at_ms   INTEGER NOT NULL,
      released_at_ms INTEGER
    );
    -- One ACTIVE owner per (room, handle). Released leases are exempt, so a
    -- handle can be re-leased after release while history is preserved.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_room_handle_lease_active
      ON room_handle_leases (room_id, handle)
      WHERE released_at_ms IS NULL;
    CREATE INDEX IF NOT EXISTS idx_room_handle_lease_session
      ON room_handle_leases (session_id) WHERE released_at_ms IS NULL;
  `);
}

function rowToLease(r: LeaseRow): HandleLease {
  return {
    id: r.id,
    room_id: r.room_id,
    handle: r.handle,
    session_id: r.session_id,
    leased_at_ms: r.leased_at_ms,
    released_at_ms: r.released_at_ms
  };
}

export class HandleLeaseConflict extends Error {
  constructor(
    public readonly roomId: string,
    public readonly handle: string,
    public readonly heldBy: string
  ) {
    super(`Handle '@${handle}' is already leased in room ${roomId} by session ${heldBy}.`);
    this.name = 'HandleLeaseConflict';
  }
}

export type LeaseHandleInput = {
  sessionId: string;
  roomId: string;
  handle: string;
};

/**
 * Lease a handle to a session within a room. Idempotent for the SAME
 * session re-leasing its own active handle (returns the existing lease).
 * Throws HandleLeaseConflict if a DIFFERENT session actively holds it.
 */
export function leaseHandle(input: LeaseHandleInput, db = getIdentityDb()): HandleLease {
  ensureTable(db);
  const handle = normaliseHandle(input.handle);
  if (handle.length === 0) throw new Error('leaseHandle: empty handle');

  const existing = db
    .prepare(
      `SELECT * FROM room_handle_leases
        WHERE room_id = ? AND handle = ? AND released_at_ms IS NULL`
    )
    .get(input.roomId, handle) as LeaseRow | undefined;
  if (existing) {
    if (existing.session_id === input.sessionId) return rowToLease(existing); // idempotent
    throw new HandleLeaseConflict(input.roomId, handle, existing.session_id);
  }

  const row: LeaseRow = {
    id: randomUUID(),
    room_id: input.roomId,
    handle,
    session_id: input.sessionId,
    leased_at_ms: Date.now(),
    released_at_ms: null
  };
  db.prepare(
    `INSERT INTO room_handle_leases (id, room_id, handle, session_id, leased_at_ms, released_at_ms)
     VALUES (@id, @room_id, @handle, @session_id, @leased_at_ms, @released_at_ms)`
  ).run(row);
  return rowToLease(row);
}

/** Release whatever session currently holds `handle` in `room`. Returns the
 *  closed lease, or null if nothing was active. Frees the handle for reuse. */
export function releaseHandle(roomId: string, handle: string, db = getIdentityDb()): HandleLease | null {
  ensureTable(db);
  const norm = normaliseHandle(handle);
  const active = db
    .prepare(`SELECT * FROM room_handle_leases WHERE room_id = ? AND handle = ? AND released_at_ms IS NULL`)
    .get(roomId, norm) as LeaseRow | undefined;
  if (!active) return null;
  db.prepare(`UPDATE room_handle_leases SET released_at_ms = ? WHERE id = ?`).run(Date.now(), active.id);
  return rowToLease({ ...active, released_at_ms: Date.now() });
}

/** Resolve the CURRENT owner session of a handle in a room (active lease
 *  only). This is the join/post/route resolution primitive. */
export function resolveHandleOwner(roomId: string, handle: string, db = getIdentityDb()): string | null {
  ensureTable(db);
  const norm = normaliseHandle(handle);
  const row = db
    .prepare(
      `SELECT session_id FROM room_handle_leases
        WHERE room_id = ? AND handle = ? AND released_at_ms IS NULL`
    )
    .get(roomId, norm) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}

/** All ACTIVE leases held by a session (its handles across rooms). */
export function sessionActiveLeases(sessionId: string, db = getIdentityDb()): HandleLease[] {
  ensureTable(db);
  const rows = db
    .prepare(`SELECT * FROM room_handle_leases WHERE session_id = ? AND released_at_ms IS NULL ORDER BY leased_at_ms ASC`)
    .all(sessionId) as LeaseRow[];
  return rows.map(rowToLease);
}

/** Historical: who held this handle in this room at a given time — powers
 *  the @name#1 render rule for old posts without rewriting history. */
export function ownerAtTime(roomId: string, handle: string, atMs: number, db = getIdentityDb()): string | null {
  ensureTable(db);
  const norm = normaliseHandle(handle);
  const row = db
    .prepare(
      `SELECT session_id FROM room_handle_leases
        WHERE room_id = ? AND handle = ? AND leased_at_ms <= ?
          AND (released_at_ms IS NULL OR released_at_ms > ?)
        ORDER BY leased_at_ms DESC LIMIT 1`
    )
    .get(roomId, norm, atMs, atMs) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}
