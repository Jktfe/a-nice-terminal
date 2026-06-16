/**
 * roomWorkerLease — SAFE HALF of the ANT→Claude mention bridge.
 *
 * Bounds Claude-worker sessions to ~one per room per active period. A
 * qualifying @-mention cold-starts ONE worker; while its lease is live, further
 * mentions in that room do NOT start a second worker (the running session
 * drains them). Crash-safe via a TTL lease: if a worker dies without releasing,
 * the lease expires and the next mention reclaims it — no callback required.
 *
 * Lives in ANT's own SQLite (~/.ant/fresh-ant.db via getIdentityDb), NOT a
 * second datastore: the emitter runs in-ANT and the worker releases via a
 * /mcp/room PATCH that reaches ANT, so one store keeps lease lifecycle
 * auditable alongside the room actions (per @researchant review, 2026-06-08).
 *
 * This module has NO network/exposure surface — it is pure local state. The
 * exposed half (Funnel + per-fire mcpGrant + routines.fire) is injected
 * separately and stays gated behind @speedy's trust-tier proofs.
 *
 * Design: /Users/ant/ANT-claude-mention-bridge-design.md (v3, §6.1).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type LeaseStatus = 'live' | 'released';

export type RoomWorkerLease = {
  roomId: string;
  sessionId: string | null;
  sessionUrl: string | null;
  fireTokenId: string | null;
  status: LeaseStatus;
  leaseExpiresAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type FireOutcome = 'launched' | 'failed' | 'suppressed';

type LeaseRow = {
  room_id: string;
  session_id: string | null;
  session_url: string | null;
  fire_token_id: string | null;
  status: LeaseStatus;
  lease_expires_at: number;
  created_at: number;
  updated_at: number;
};

// Tables aren't in db.ts's central SCHEMA_DDL — self-ensure idempotently on
// first use so this module is drop-in without touching the migration array.
let schemaReady = false;
function ensureSchema(): void {
  if (schemaReady) return;
  const db = getIdentityDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_worker_lease (
      room_id          TEXT PRIMARY KEY,
      session_id       TEXT,
      session_url      TEXT,
      fire_token_id    TEXT,
      status           TEXT NOT NULL CHECK (status IN ('live','released')),
      lease_expires_at INTEGER NOT NULL,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_worker_fire_log (
      id        TEXT PRIMARY KEY,
      room_id   TEXT NOT NULL,
      fired_at  INTEGER NOT NULL,
      outcome   TEXT NOT NULL CHECK (outcome IN ('launched','failed','suppressed')),
      detail    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_room_worker_fire_log_room_time
      ON room_worker_fire_log (room_id, fired_at);
  `);
  schemaReady = true;
}

function mapRow(row: LeaseRow): RoomWorkerLease {
  return {
    roomId: row.room_id,
    sessionId: row.session_id,
    sessionUrl: row.session_url,
    fireTokenId: row.fire_token_id,
    status: row.status,
    leaseExpiresAtMs: row.lease_expires_at,
    createdAtMs: row.created_at,
    updatedAtMs: row.updated_at
  };
}

/**
 * Atomically acquire the room's worker lease. Wins iff there is no live,
 * unexpired lease. The loser does nothing — the live worker drains the message.
 * Returns true on acquire. Transactional so concurrent inserts can't both win.
 */
export function tryAcquireLease(roomId: string, ttlMs: number, now = Date.now()): boolean {
  ensureSchema();
  const db = getIdentityDb();
  const acquire = db.transaction((id: string, ttl: number, t: number): boolean => {
    const row = db
      .prepare('SELECT status, lease_expires_at FROM room_worker_lease WHERE room_id = ?')
      .get(id) as Pick<LeaseRow, 'status' | 'lease_expires_at'> | undefined;
    if (row && row.status === 'live' && row.lease_expires_at > t) return false;
    db.prepare(
      `INSERT INTO room_worker_lease
         (room_id, session_id, session_url, fire_token_id, status, lease_expires_at, created_at, updated_at)
       VALUES (?, NULL, NULL, NULL, 'live', ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET
         status           = 'live',
         lease_expires_at = excluded.lease_expires_at,
         session_id       = NULL,
         session_url      = NULL,
         fire_token_id    = NULL,
         updated_at       = excluded.updated_at`
    ).run(id, t + ttl, t, t);
    return true;
  });
  return acquire(roomId, ttlMs, now);
}

/** Stamp the fired session + per-fire grant id onto the live lease. */
export function recordSession(
  roomId: string,
  sessionId: string,
  sessionUrl: string | null,
  fireTokenId: string | null,
  now = Date.now()
): void {
  ensureSchema();
  getIdentityDb()
    .prepare(
      `UPDATE room_worker_lease
         SET session_id = ?, session_url = ?, fire_token_id = ?, updated_at = ?
       WHERE room_id = ?`
    )
    .run(sessionId, sessionUrl, fireTokenId, now, roomId);
}

/** Mark the lease released so the next mention can cold-start a new worker. */
export function releaseLease(roomId: string, now = Date.now()): void {
  ensureSchema();
  getIdentityDb()
    .prepare(`UPDATE room_worker_lease SET status = 'released', updated_at = ? WHERE room_id = ?`)
    .run(now, roomId);
}

export function getLease(roomId: string): RoomWorkerLease | null {
  ensureSchema();
  const row = getIdentityDb()
    .prepare('SELECT * FROM room_worker_lease WHERE room_id = ?')
    .get(roomId) as LeaseRow | undefined;
  return row ? mapRow(row) : null;
}

/** Append a fire-log entry (powers rate-limit + breaker + instrumentation). */
export function logFire(roomId: string, outcome: FireOutcome, detail: string | null = null, now = Date.now()): void {
  ensureSchema();
  getIdentityDb()
    .prepare('INSERT INTO room_worker_fire_log (id, room_id, fired_at, outcome, detail) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), roomId, now, outcome, detail);
}

/** Count fires (launched) for a room within the trailing window — rate-limit. */
export function recentLaunchCount(roomId: string, windowMs: number, now = Date.now()): number {
  ensureSchema();
  const row = getIdentityDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM room_worker_fire_log
        WHERE room_id = ? AND outcome = 'launched' AND fired_at > ?`
    )
    .get(roomId, now - windowMs) as { n: number };
  return row.n;
}

/**
 * Breaker: open (suppress) when the last `threshold` outcomes are all 'failed'
 * and the most recent failure is within `cooldownMs`. Auto-closes once the
 * cooldown elapses. Stateless — derived from the fire log.
 */
export function breakerOpen(
  roomId: string,
  threshold = 3,
  cooldownMs = 5 * 60_000,
  now = Date.now()
): boolean {
  ensureSchema();
  const rows = getIdentityDb()
    .prepare('SELECT outcome, fired_at FROM room_worker_fire_log WHERE room_id = ? ORDER BY fired_at DESC LIMIT ?')
    .all(roomId, threshold) as Array<Pick<LeaseRow, never> & { outcome: FireOutcome; fired_at: number }>;
  if (rows.length < threshold) return false;
  const allFailed = rows.every((r) => r.outcome === 'failed');
  if (!allFailed) return false;
  return rows[0].fired_at > now - cooldownMs;
}

/** Test/maintenance helper: wipe both tables. */
export function _resetRoomWorkerStateForTests(): void {
  ensureSchema();
  const db = getIdentityDb();
  db.prepare('DELETE FROM room_worker_lease').run();
  db.prepare('DELETE FROM room_worker_fire_log').run();
}
