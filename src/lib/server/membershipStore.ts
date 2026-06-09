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
 * NEW standalone store built to be cut over to. The table name
 * `room_membership` (singular) is distinct from the legacy
 * `room_memberships` (plural), so the two coexist during the build and there
 * is no schema collision. During cutover, writes with a resolved durable
 * session also mirror the terminal binding into legacy room_memberships so
 * transitional readers cannot keep pointing at stale panes.
 */

import { getIdentityDb } from './db';
import { getSession } from './antSessionStore';
import { syncMembershipTerminalBinding } from './roomMembershipsStore';
import { claimHandle, retireActiveLeasesForHandle } from './roomHandleLeaseClean';
import { getLiveAgentByHandle } from './v02AgentsStore';
import { addMembership as addV02Membership } from './v02MembershipsStore';
import { isOperatorHandle } from './operatorHandle';

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

function mirrorLegacyTerminalBinding(roomId: string, handle: string, sessionId: string | null): void {
  if (sessionId === null) return;
  const session = getSession(sessionId);
  if (!session?.terminal_id) return;
  try {
    syncMembershipTerminalBinding({ room_id: roomId, handle, terminal_id: session.terminal_id });
  } catch {
    // Clean membership is authoritative. Some tests and transitional paths
    // create clean rows before the legacy room/terminal FK graph exists; do
    // not let the compatibility mirror block the durable write.
  }
}

/**
 * THE one-writer invariant (2026-06-08, JWPK Oldboys msg_3iqrmww20n "if you are
 * in a room and receiving messages how does it make sense you aren't bound").
 *
 * Delivery/fanout reads room_membership.session_id (this table), but the POST
 * gate reads room_handle_lease (chatRoomReadGate/messages → isCleanMember).
 * When an add wrote membership but NOT the lease, an agent received messages yet
 * 403'd on post — "in the room but unbound". So every membership write also
 * claims the clean lease for the SAME authoritative session, in lockstep, so the
 * two surfaces can never drift: member ⟹ can post.
 *
 * Keyed on the membership's RESOLVED session_id (post-hijack-guard), never the
 * raw caller — a different live session re-adding @x is a no-op on the
 * membership session AND therefore on the lease (claimHandle is idempotent for
 * the incumbent). claimHandle is self-contained (creates its own table, no
 * joins) so it cannot throw on missing deps — the invariant is firm, not
 * best-effort. No gate is relaxed: this is a WRITE that makes the existing gate
 * find the row it already requires (moat intact — see the spoof analysis that
 * ruled out relaxing the READ gate to a self-declared deriveHandle).
 */
function mirrorCleanLease(roomId: string, handle: string, sessionId: string | null, db = getIdentityDb()): void {
  if (sessionId === null) return;
  claimHandle(roomId, handle, sessionId, db);
}

function mirrorV02Membership(roomId: string, handle: string, db = getIdentityDb()): void {
  const roomExists = db
    .prepare(`SELECT 1 FROM rooms WHERE room_id = ? LIMIT 1`)
    .get(roomId) as { 1: number } | undefined;
  if (!roomExists) return;
  const agent = getLiveAgentByHandle(handle, db);
  if (!agent) return;
  addV02Membership({
    agent_id: agent.agent_id,
    room_id: roomId,
    member_kind: isOperatorHandle(handle) ? 'human' : 'agent'
  });
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
  mirrorLegacyTerminalBinding(roomId, handle, row.session_id);
  mirrorCleanLease(roomId, handle, row.session_id, db);
  mirrorV02Membership(roomId, handle, db);
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
  mirrorLegacyTerminalBinding(roomId, handle, next.session_id);
  mirrorCleanLease(roomId, handle, next.session_id, db);
  return rowToMembership(next);
}

/** Remove a member — a hard DELETE of the row (no soft-revoke).
 *  Also retires the post-gate leases for that room handle so a kick/reinvite
 *  cannot leave stale sessions active under the old handle. */
export function removeMember(roomId: string, handle: string, db = getIdentityDb()): boolean {
  ensureTable(db);
  const retiredLeases = isDurableMemberHandle(handle)
    ? retireActiveLeasesForHandle(roomId, handle, db)
    : 0;
  const res = db.prepare(`DELETE FROM room_membership WHERE room_id = ? AND handle = ?`).run(roomId, handle);
  return res.changes > 0 || retiredLeases > 0;
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

/** Resolve the handle mapped to a durable session in one room. This is the
 *  clean inverse of resolveMember and is used by CLI/server identity gates
 *  that already possess the durable session token. */
export function resolveHandleForSession(roomId: string, sessionId: string, db = getIdentityDb()): string | null {
  ensureTable(db);
  const trimmedSessionId = sessionId.trim();
  if (trimmedSessionId.length === 0) return null;
  const row = db
    .prepare(
      `SELECT handle FROM room_membership
        WHERE room_id = ? AND session_id = ? AND ${durableMemberWhereClause()}
        ORDER BY created_at_ms ASC, handle ASC
        LIMIT 1`
    )
    .get(roomId, trimmedSessionId) as { handle: string } | undefined;
  return row?.handle ?? null;
}

/**
 * Resolve the handle a TERMINAL currently wears, across all rooms, via the
 * durable-session join (terminal → ant_sessions → room_membership). Used by
 * whoami: post-cut-over a live agent's handle lives here keyed by its durable
 * session, NOT in terminal_records.handle / agents.primary_handle (both empty
 * for current rows), so whoami otherwise reports "registered-no-handle" for an
 * agent that is demonstrably a live room member. Returns the most-recently-
 * joined handle, or null if the terminal holds no durable membership.
 *
 * Read-only — never writes a membership or lease. ant_sessions is owned by
 * antSessionStore; in unit contexts it may not exist yet, so guard explicitly
 * rather than letting the JOIN throw on a missing table.
 *
 * BEST-EFFORT PRIMARY HANDLE (not authoritative for a specific room): for an
 * agent in multiple rooms under different handles this returns the
 * most-recently-joined room's handle. That is fine for whoami (a self-ID hint)
 * because the POST path ALWAYS re-resolves the handle per-room server-side, so
 * this value never drives attribution. A handle from a room the agent has LEFT
 * cannot be returned: removal is a hard DELETE (no soft-delete row lingers).
 */
export function resolveHandleForTerminal(terminalId: string, db = getIdentityDb()): string | null {
  ensureTable(db);
  const trimmed = terminalId.trim();
  if (trimmed.length === 0) return null;
  const hasSessions = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ant_sessions'`)
    .get() as { 1: number } | undefined;
  if (!hasSessions) return null;
  const row = db
    .prepare(
      `SELECT m.handle FROM room_membership m
         JOIN ant_sessions s ON s.id = m.session_id
        WHERE s.terminal_id = ? AND ${durableMemberWhereClause('m.handle')}
        ORDER BY m.created_at_ms DESC, m.handle ASC
        LIMIT 1`
    )
    .get(trimmed) as { handle: string } | undefined;
  return row?.handle ?? null;
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
