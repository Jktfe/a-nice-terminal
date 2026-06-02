/**
 * membershipBackfillClean — a CALLABLE (never auto-run) one-time seed that
 * populates the clean `room_membership` table from the current legacy
 * `room_memberships` rows, so the cutover has real data.
 *
 * The mapping (spec point 2/3 — handle keys, durable session resolves):
 *   legacy room_memberships(room_id, handle, terminal_id) is keyed by
 *   terminal_id. The clean model is keyed by the DURABLE session. So for each
 *   active legacy row we map terminal_id -> the ant_sessions row BOUND to that
 *   terminal (ant_sessions.terminal_id), and write (room_id, handle,
 *   session_id). When no session resolves for the terminal, we still write the
 *   membership (handle is the identity) with session_id = NULL — lossless on
 *   the (room, handle) identity, the session simply rebinds later.
 *
 * "Active" = legacy rows that are NOT soft-revoked. revoked_at_ms is an
 * ALTER-added column (db.ts) so it may be absent on an old DB; we detect it via
 * PRAGMA and only filter when present.
 *
 * Idempotent: re-running upserts the same (room, handle) rows (membershipStore
 * upsert), so counts stabilise. Does NOT modify or delete the legacy table.
 */

import { getIdentityDb } from './db';
import { addMember } from './membershipStore';

export type BackfillReport = {
  /** Active legacy rows examined. */
  scanned: number;
  /** Clean rows written (insert or upsert). */
  inserted: number;
  /** Rows skipped (e.g. missing room_id/handle) — should normally be 0. */
  skipped: number;
};

type LegacyRow = {
  room_id: string | null;
  handle: string | null;
  terminal_id: string | null;
};

function hasColumn(db: ReturnType<typeof getIdentityDb>, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function tableExists(db: ReturnType<typeof getIdentityDb>, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

/**
 * Backfill clean `room_membership` from legacy `room_memberships`.
 * Returns a lossless count report. Safe to call repeatedly (idempotent upsert).
 */
export function backfillFromLegacy(db = getIdentityDb()): BackfillReport {
  // No legacy table => nothing to do (fresh install / test DB).
  if (!tableExists(db, 'room_memberships')) {
    return { scanned: 0, inserted: 0, skipped: 0 };
  }

  const filterRevoked = hasColumn(db, 'room_memberships', 'revoked_at_ms');
  const where = filterRevoked ? `WHERE revoked_at_ms IS NULL` : ``;
  const legacy = db
    .prepare(`SELECT room_id, handle, terminal_id FROM room_memberships ${where}`)
    .all() as LegacyRow[];

  // Map a terminal_id -> the durable ant_sessions id bound to it. Only present
  // when ant_sessions exists AND carries a terminal_id column (both true on a
  // post-antSessionStore DB; guarded for older DBs).
  const canMapSession =
    tableExists(db, 'ant_sessions') && hasColumn(db, 'ant_sessions', 'terminal_id');

  const resolveSession = (terminalId: string | null): string | null => {
    if (!canMapSession || !terminalId) return null;
    // If multiple sessions ever bound the same terminal, prefer the most
    // recently seen — that is the live identity for that terminal.
    const row = db
      .prepare(
        `SELECT id FROM ant_sessions WHERE terminal_id = ? ORDER BY last_seen_at_ms DESC LIMIT 1`
      )
      .get(terminalId) as { id: string } | undefined;
    return row ? row.id : null;
  };

  let scanned = 0;
  let inserted = 0;
  let skipped = 0;

  for (const r of legacy) {
    scanned++;
    if (!r.room_id || !r.handle) {
      skipped++;
      continue;
    }
    const sessionId = resolveSession(r.terminal_id);
    addMember(r.room_id, r.handle, sessionId, db);
    inserted++;
  }

  return { scanned, inserted, skipped };
}
