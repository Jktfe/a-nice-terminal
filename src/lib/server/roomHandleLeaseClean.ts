/**
 * roomHandleLeaseClean — THE canonical handle-lease-history store.
 *
 * Encodes the four JWPK rules for how a room handle (e.g. @x) is held, removed,
 * reclaimed, and collided-on, while keeping a durable HISTORY so that posts made
 * under a now-suffixed handle still render correctly:
 *
 *   Rule 1 — Stability: a handle, once displayed a certain way for a session,
 *            stays that way unless an explicit action changes it. Removing or
 *            renumbering one holder never silently renumbers the others.
 *   Rule 2 — Remove suffixes the incumbent: `ant room X remove @x` retires the
 *            clean (suffix-0) holder, gives it a STABLE next-free suffix (its
 *            posts now render @x-N, dash), and frees @x for the next claimant.
 *   Rule 3 — Same-session revert + stable suffix: if the original session that
 *            once held @x re-claims it, it REVERTS to the clean @x (demoting
 *            whoever currently holds it). Its suffix assignment is STABLE — a
 *            re-remove re-uses the same @x-1, it never renumbers to @x-2. A
 *            DIFFERENT session re-claiming does NOT revert.
 *   Rule 4 — Collision is suffix, not error: a second active session claiming a
 *            held @x is GRANTED @x-1 (lowest free integer), no error. The next
 *            gets @x-2, and so on; freed suffixes are reused (lowest-free).
 *
 * INVARIANT: at most ONE active suffix-0 holder per (room, handle).
 *            `assigned_suffix` is STABLE once set (rule 3).
 *
 * `handle` is stored as the @-normalised BASE (e.g. '@x'). Display is derived:
 *   suffix === 0 ? '@x' : '@x-N'   (DASH, not '#').
 *
 * Self-contained table init (roomPolicyStore pattern). NEW standalone store —
 * does NOT touch the legacy room_handle_leases / room_memberships tables.
 */

import { getIdentityDb } from './db';

export type HandleLease = {
  room_id: string;
  /** @-normalised BASE handle, e.g. '@x'. */
  handle: string;
  session_id: string;
  /** Current display suffix; 0 = clean (@x). */
  suffix: number;
  /** Stable non-zero suffix once this session has ever been suffixed (rule 3). */
  assigned_suffix: number | null;
  /** 1 = live member; 0 = retired (history only). */
  active: boolean;
  created_at_ms: number;
  retired_at_ms: number | null;
};

type LeaseRow = {
  room_id: string;
  handle: string;
  session_id: string;
  suffix: number;
  assigned_suffix: number | null;
  active: number;
  created_at_ms: number;
  retired_at_ms: number | null;
};

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_handle_lease (
      room_id         TEXT NOT NULL,
      handle          TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      suffix          INTEGER NOT NULL DEFAULT 0,
      assigned_suffix INTEGER,
      active          INTEGER NOT NULL DEFAULT 1,
      created_at_ms   INTEGER NOT NULL,
      retired_at_ms   INTEGER,
      PRIMARY KEY (room_id, handle, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_room_handle_lease_room ON room_handle_lease (room_id);
    CREATE INDEX IF NOT EXISTS idx_room_handle_lease_room_handle ON room_handle_lease (room_id, handle);
    CREATE INDEX IF NOT EXISTS idx_room_handle_lease_room_session ON room_handle_lease (room_id, session_id);
  `);
}

/** @-normalise to the BASE handle: trim, strip leading @, re-prefix a single @. */
function normaliseBase(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  const withoutAt = trimmed.replace(/^@+/, '');
  return `@${withoutAt}`;
}

/** Derive the display string for a lease row: '@x' clean, '@x-N' suffixed. */
function display(handle: string, suffix: number): string {
  return suffix === 0 ? handle : `${handle}-${suffix}`;
}

function rowToLease(r: LeaseRow): HandleLease {
  return {
    room_id: r.room_id,
    handle: r.handle,
    session_id: r.session_id,
    suffix: r.suffix,
    assigned_suffix: r.assigned_suffix,
    active: r.active === 1,
    created_at_ms: r.created_at_ms,
    retired_at_ms: r.retired_at_ms
  };
}

function getRow(
  db: ReturnType<typeof getIdentityDb>,
  roomId: string,
  handle: string,
  sessionId: string
): LeaseRow | undefined {
  return db
    .prepare(
      `SELECT * FROM room_handle_lease WHERE room_id = ? AND handle = ? AND session_id = ?`
    )
    .get(roomId, handle, sessionId) as LeaseRow | undefined;
}

function getCleanHolder(
  db: ReturnType<typeof getIdentityDb>,
  roomId: string,
  handle: string
): LeaseRow | undefined {
  return db
    .prepare(
      `SELECT * FROM room_handle_lease
        WHERE room_id = ? AND handle = ? AND active = 1 AND suffix = 0
        LIMIT 1`
    )
    .get(roomId, handle) as LeaseRow | undefined;
}

/** The set of suffixes currently in use by ACTIVE suffixed (suffix>0) holders. */
function activeSuffixes(
  db: ReturnType<typeof getIdentityDb>,
  roomId: string,
  handle: string
): Set<number> {
  const rows = db
    .prepare(
      `SELECT suffix FROM room_handle_lease
        WHERE room_id = ? AND handle = ? AND active = 1 AND suffix > 0`
    )
    .all(roomId, handle) as Array<{ suffix: number }>;
  return new Set(rows.map((r) => r.suffix));
}

function lowestFreeSuffix(used: Set<number>): number {
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/**
 * Claim a handle in a room for a session. Returns the granted display handle
 * (@x or @x-N). Never throws on collision (rule 4).
 */
export function claimHandle(
  roomId: string,
  rawHandle: string,
  sessionId: string,
  db = getIdentityDb()
): string {
  ensureTable(db);
  const handle = normaliseBase(rawHandle);
  const now = Date.now();

  const existing = getRow(db, roomId, handle, sessionId);

  // (1) This exact session has history on @x here.
  if (existing) {
    // Already the clean holder — idempotent.
    if (existing.active === 1 && existing.suffix === 0) {
      return handle;
    }
    // REVERT to clean (rule 3): demote whoever currently holds clean @x, then
    // promote this session back to suffix 0. assigned_suffix is preserved.
    const clean = getCleanHolder(db, roomId, handle);
    if (clean && clean.session_id !== sessionId) {
      demoteToSuffix(db, roomId, handle, clean, now);
    }
    db.prepare(
      `UPDATE room_handle_lease
          SET active = 1, suffix = 0, retired_at_ms = NULL
        WHERE room_id = ? AND handle = ? AND session_id = ?`
    ).run(roomId, handle, sessionId);
    return handle;
  }

  // (2) No history for this session.
  const clean = getCleanHolder(db, roomId, handle);
  if (!clean) {
    // @x is free — clean claim.
    db.prepare(
      `INSERT INTO room_handle_lease
         (room_id, handle, session_id, suffix, assigned_suffix, active, created_at_ms, retired_at_ms)
       VALUES (?, ?, ?, 0, NULL, 1, ?, NULL)`
    ).run(roomId, handle, sessionId, now);
    return handle;
  }

  // (3) Held by another active session — assign lowest free suffix (rule 4).
  const suffix = lowestFreeSuffix(activeSuffixes(db, roomId, handle));
  db.prepare(
    `INSERT INTO room_handle_lease
       (room_id, handle, session_id, suffix, assigned_suffix, active, created_at_ms, retired_at_ms)
     VALUES (?, ?, ?, ?, ?, 1, ?, NULL)`
  ).run(roomId, handle, sessionId, suffix, suffix, now);
  return display(handle, suffix);
}

/**
 * Register-time self-heal: re-key the CLEAN (@x) handle in a room to `sessionId`
 * (the caller's REAL durable token) when the current clean holder is STALE — its
 * session no longer resolves to a live identity (a dead terminal-id key or a
 * superseded token). This is the manual lease-repair recipe, in code.
 *
 * Why this exists: the post-gate reads THIS table keyed by session token, but
 * `POST /api/identity/register` historically only backfilled the legacy PLURAL
 * `room_handle_leases`, never this clean SINGULAR `room_handle_lease`. So an
 * agent whose clean lease was minted under a now-dead terminal-id stayed mute in
 * invite rooms (which never auto-join). Calling this on register lets the agent
 * re-assert its own handle with its own token, with no manual DB surgery.
 *
 * Security (no-hijack): we only demote the incumbent when `isHolderStale`
 * reports it is NOT a genuinely-live DIFFERENT session. A live different holder
 * keeps clean @x and the caller falls through to a rule-4 suffix — a different
 * live session can never steal @x. The staleness window is identical to the
 * already-shipped register handle-uniqueness exemption (claimantIsStale), so
 * this adds no new attack surface.
 *
 * Returns the granted clean display handle (@x) when reclaimed/free/already-held,
 * or null when a genuinely-live different session holds @x (strict no-op — Part 2
 * never joins a room or demotes a live holder).
 */
export function reclaimCleanHandleIfStale(
  roomId: string,
  rawHandle: string,
  sessionId: string,
  isHolderStale: (holderSessionId: string) => boolean,
  db = getIdentityDb()
): string | null {
  ensureTable(db);
  const handle = normaliseBase(rawHandle);
  const clean = getCleanHolder(db, roomId, handle);
  if (clean && clean.session_id !== sessionId) {
    if (!isHolderStale(clean.session_id)) {
      // A genuinely-live DIFFERENT session holds clean @x. Do NOTHING — do not
      // suffix-join the caller into this room and do not demote the live holder.
      // (In the normal flow Part 1 has already suffixed an impostor's handle so
      // this room never appears for them; this guards the edge case where the
      // live holder has no terminal_record and Part 1 couldn't see the clash.)
      return null;
    }
    // Stale incumbent: retire (not demote) the dead terminal-id/token so the
    // real token can take clean @x. Its history row is preserved for rendering.
    db.prepare(
      `UPDATE room_handle_lease
          SET active = 0, retired_at_ms = ?
        WHERE room_id = ? AND handle = ? AND session_id = ?`
    ).run(Date.now(), roomId, handle, clean.session_id);
  }
  // No clean holder, a now-retired stale incumbent, or it's already us →
  // promote sessionId to clean @x (idempotent when it already holds it).
  return claimHandle(roomId, handle, sessionId, db);
}

/**
 * Demote the given (currently clean) holder to a suffix: reuse its STABLE
 * assigned_suffix if it has one and that suffix is free, otherwise the lowest
 * free suffix. Keeps the lease ACTIVE (it remains a member, just suffixed).
 */
function demoteToSuffix(
  db: ReturnType<typeof getIdentityDb>,
  roomId: string,
  handle: string,
  holder: LeaseRow,
  nowMs: number
): number {
  const used = activeSuffixes(db, roomId, handle);
  let suffix: number;
  if (holder.assigned_suffix !== null && !used.has(holder.assigned_suffix)) {
    suffix = holder.assigned_suffix;
  } else {
    suffix = lowestFreeSuffix(used);
  }
  db.prepare(
    `UPDATE room_handle_lease
        SET suffix = ?, assigned_suffix = ?, active = 1, retired_at_ms = ?
      WHERE room_id = ? AND handle = ? AND session_id = ?`
  ).run(suffix, suffix, nowMs, roomId, handle, holder.session_id);
  return suffix;
}

/**
 * The `ant room X remove @handle` trigger: retire the current active clean
 * (suffix-0) holder, give it a STABLE next-free suffix (its posts now render
 * @x-N, rule 2), and free suffix 0. The retired holder is no longer a clean
 * member (active flips to 0) but its history row remains for rendering.
 * Returns the @x-N it assigned, or null if there was no active clean holder.
 */
export function removeHandle(
  roomId: string,
  rawHandle: string,
  db = getIdentityDb()
): string | null {
  ensureTable(db);
  const handle = normaliseBase(rawHandle);
  const now = Date.now();

  const clean = getCleanHolder(db, roomId, handle);
  if (!clean) return null;

  // STABLE suffix: reuse the holder's assigned_suffix if it already has one
  // (and it's free), otherwise the lowest free integer.
  const used = activeSuffixes(db, roomId, handle);
  let suffix: number;
  if (clean.assigned_suffix !== null && !used.has(clean.assigned_suffix)) {
    suffix = clean.assigned_suffix;
  } else {
    suffix = lowestFreeSuffix(used);
  }

  db.prepare(
    `UPDATE room_handle_lease
        SET suffix = ?, assigned_suffix = ?, active = 0, retired_at_ms = ?
      WHERE room_id = ? AND handle = ? AND session_id = ?`
  ).run(suffix, suffix, now, roomId, handle, clean.session_id);

  return display(handle, suffix);
}

/**
 * The display handle (@x or @x-N) for a session's lease in a room — drives both
 * current and historical post rendering. Returns the most recently-touched
 * lease for the session if it holds several (it should hold at most one).
 */
export function displayHandleForSession(
  roomId: string,
  sessionId: string,
  db = getIdentityDb()
): string | null {
  ensureTable(db);
  const row = db
    .prepare(
      `SELECT * FROM room_handle_lease
        WHERE room_id = ? AND session_id = ?
        ORDER BY active DESC, COALESCE(retired_at_ms, created_at_ms) DESC
        LIMIT 1`
    )
    .get(roomId, sessionId) as LeaseRow | undefined;
  if (!row) return null;
  return display(row.handle, row.suffix);
}

/** All leases in a room, oldest first (active and retired). */
export function listLeases(roomId: string, db = getIdentityDb()): HandleLease[] {
  ensureTable(db);
  const rows = db
    .prepare(
      `SELECT * FROM room_handle_lease WHERE room_id = ? ORDER BY created_at_ms ASC, handle ASC, suffix ASC`
    )
    .all(roomId) as LeaseRow[];
  return rows.map(rowToLease);
}

/** Whether the session holds any ACTIVE lease (clean or suffixed) in the room. */
export function isMember(roomId: string, sessionId: string, db = getIdentityDb()): boolean {
  ensureTable(db);
  const row = db
    .prepare(
      `SELECT 1 FROM room_handle_lease WHERE room_id = ? AND session_id = ? AND active = 1 LIMIT 1`
    )
    .get(roomId, sessionId) as { 1: number } | undefined;
  return row !== undefined;
}

/** The session currently wearing the clean @x in a room, or null. */
export function resolveMember(
  roomId: string,
  rawHandle: string,
  db = getIdentityDb()
): string | null {
  ensureTable(db);
  const handle = normaliseBase(rawHandle);
  const clean = getCleanHolder(db, roomId, handle);
  return clean ? clean.session_id : null;
}
