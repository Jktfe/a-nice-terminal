/**
 * durableActivationHealth — READ-ONLY "deployed-but-dormant" self-detector for
 * the Simplify & Harden durable-identity model (tables `ant_sessions` +
 * `room_handle_leases`), plan room-identity-stage-full-delivery-2026-06-02.
 *
 * THE TRAP THIS CLOSES (bitten twice):
 *   The durable-identity model can be fully DEPLOYED — code merged, tables
 *   present — yet completely DORMANT, because no client actually registers a
 *   durable session: the fleet still authenticates via the old
 *   pidChain/room-token fallback path, so `ant_sessions` stays EMPTY. There is
 *   no error, no 403, nothing red — the new model is just silently unused.
 *   This module makes that condition SELF-DETECTING, mirroring the #139
 *   room-health invariant read-model (listRoomHealth / summariseRoomHealth):
 *   SELECT/COUNT only, writes to NO table, surfaces a structured verdict.
 *
 * VERDICT (counts are the only inputs; thresholds tuned to the trap):
 *   - liveTerminals counted the #139 way: a terminal_records row whose pane is
 *     current (superseded_at_ms IS NULL) JOINed to a terminals row that is
 *     alive (terminals.status = 'live'). Recycled panes + archived/deleted
 *     terminals are excluded — they cannot transact, so they are not signal.
 *   - antSessions  = COUNT(ant_sessions). Tolerant of the table not existing
 *     yet (the dormant case can precede the first antSessionStore call, which
 *     is what lazily creates the table) — absent table is read as 0, never an
 *     error.
 *   - activeLeases = COUNT(room_handle_leases WHERE active_until_ms IS NULL).
 *   - oldMemberships = COUNT(room_memberships WHERE revoked_at_ms IS NULL) —
 *     the fallback path's footprint, for contrast.
 *
 *   status:
 *     liveTerminals === 0                       -> 'idle'    (no fleet to judge; not a false alarm)
 *     liveTerminals > 0 AND antSessions === 0   -> 'dormant' (deployed, unpopulated, fleet on fallback)
 *     0 < antSessions < liveTerminals           -> 'partial' (some clients migrated to durable path)
 *     antSessions >= liveTerminals (> 0)        -> 'active'  (durable sessions cover the live fleet)
 *
 * INVARIANTS OF THIS MODULE:
 *   - SELECT/COUNT-only. NEVER writes to ant_sessions / room_handle_leases /
 *     terminals / terminal_records / room_memberships or any identity table.
 *   - It does not own or duplicate the durable-identity stores, leases, or the
 *     auth gates (workstream A). It READS the same tables they enforce on and
 *     reports the activation contract for human eyes.
 *   - Uses the SAME db accessor (getIdentityDb) + the SAME self-contained,
 *     read-only style as roomHealthStore.
 */

import { getIdentityDb } from './db';

/** The identity db handle type, inferred from the shared accessor (db.ts does
 *  not export its DatabaseInstance alias). */
type IdentityDb = ReturnType<typeof getIdentityDb>;

export type DurableActivationStatus = 'active' | 'partial' | 'dormant' | 'idle';

export interface DurableActivationCounts {
  /** Rows in ant_sessions (durable identities). 0 when the table is absent. */
  antSessions: number;
  /** room_handle_leases with active_until_ms IS NULL (currently-held handles). */
  activeLeases: number;
  /** Live terminals, counted the #139 way (superseded_at_ms IS NULL + status='live'). */
  liveTerminals: number;
  /** Non-revoked room_memberships — the fallback path's footprint, for contrast. */
  oldMemberships: number;
}

export interface DurableActivationSummary {
  status: DurableActivationStatus;
  /** Single human-readable explanation of the verdict. */
  reason: string;
  counts: DurableActivationCounts;
}

/** Does a table exist in the current schema? (dormant can precede the lazy
 *  CREATE TABLE in antSessionStore, so a missing ant_sessions must read as 0,
 *  never throw.) */
function tableExists(db: IdentityDb, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { 1: number } | undefined;
  return Boolean(row);
}

function countOrZero(db: IdentityDb, sql: string, table: string): number {
  if (!tableExists(db, table)) return 0;
  const row = db.prepare(sql).get() as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Read-only activation verdict for the durable-identity model. Pass a db for
 * tests; defaults to the shared identity db (matches roomHealthStore).
 */
export function summariseDurableActivation(db: IdentityDb = getIdentityDb()): DurableActivationSummary {
  const antSessions = countOrZero(db, `SELECT COUNT(1) AS n FROM ant_sessions`, 'ant_sessions');

  const activeLeases = countOrZero(
    db,
    `SELECT COUNT(1) AS n FROM room_handle_leases WHERE active_until_ms IS NULL`,
    'room_handle_leases'
  );

  // liveTerminals — same definition as roomHealthStore.listRoomHealth:
  // current pane (superseded_at_ms IS NULL) on a live backing terminal.
  const liveTerminals = tableExists(db, 'terminal_records')
    ? ((
        db
          .prepare(
            `SELECT COUNT(1) AS n
               FROM terminal_records tr
               JOIN terminals t ON t.id = tr.session_id
              WHERE tr.superseded_at_ms IS NULL
                AND t.status = 'live'`
          )
          .get() as { n: number } | undefined
      )?.n ?? 0)
    : 0;

  const oldMemberships = countOrZero(
    db,
    `SELECT COUNT(1) AS n FROM room_memberships WHERE revoked_at_ms IS NULL`,
    'room_memberships'
  );

  const counts: DurableActivationCounts = { antSessions, activeLeases, liveTerminals, oldMemberships };

  let status: DurableActivationStatus;
  let reason: string;
  if (liveTerminals === 0) {
    status = 'idle';
    reason = 'No live terminals — nothing to judge; durable-identity activation is not applicable right now.';
  } else if (antSessions === 0) {
    status = 'dormant';
    reason =
      `Durable identity deployed but UNPOPULATED: ${liveTerminals} live terminal(s) and 0 ant_sessions — ` +
      `the fleet is still on the fallback (pidChain / room-token) path. No client is registering a durable session.`;
  } else if (antSessions < liveTerminals) {
    status = 'partial';
    reason =
      `Partial activation: ${antSessions} durable session(s) for ${liveTerminals} live terminal(s) — ` +
      `some clients are on the durable path while others remain on the fallback path.`;
  } else {
    status = 'active';
    reason =
      `Active: ${antSessions} durable session(s) cover ${liveTerminals} live terminal(s) ` +
      `(${activeLeases} active room-handle lease(s)).`;
  }

  return { status, reason, counts };
}
