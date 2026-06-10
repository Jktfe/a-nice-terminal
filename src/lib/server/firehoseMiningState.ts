/**
 * firehoseMiningState — the WATERMARK for the firehose mining pass.
 *
 * Per the firehose-mining design (docs/superpowers/specs/2026-06-10-firehose-
 * mining-design.md), mining is incremental: the selector EXCLUDES already-mined
 * `(terminal_id, window_start_ms, window_end_ms)` sessions so every run only
 * touches new high-signal work. This module owns that record.
 *
 * Storage lives on the telemetry sidecar DB alongside the firehose it tracks
 * (`getTelemetryDb()`), so the watermark moves with the data. The table is
 * created on demand (CREATE TABLE IF NOT EXISTS) — no migration ordering, same
 * self-contained pattern as the firehose tables.
 *
 * A one-off backlog sweep = clear this table (the watermark) and re-run; mining
 * reads the firehose, this records what's been consumed, and nothing is ever
 * deleted from the firehose itself.
 */

import { getTelemetryDb } from './telemetryDb';

export type MinedSessionKey = {
  terminalId: string;
  windowStartMs: number;
  windowEndMs: number;
};

/**
 * Idempotent table creation. The composite primary key makes a re-mark of the
 * same session a no-op (ON CONFLICT DO NOTHING preserves the original
 * mined_at_ms — the provenance of when it was FIRST mined).
 *
 * Run unconditionally (CREATE TABLE IF NOT EXISTS is cheap) rather than gated
 * by a module-level flag: a test-time `resetTelemetryDbForTests()` deletes the
 * file and drops the global handle behind our back, so any "already ensured"
 * cache would desync and skip re-creating the table on the fresh DB.
 */
function ensureTable(db: ReturnType<typeof getTelemetryDb>): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS firehose_mined_sessions (
       terminal_id     TEXT    NOT NULL,
       window_start_ms INTEGER NOT NULL,
       window_end_ms   INTEGER NOT NULL,
       mined_at_ms     INTEGER NOT NULL,
       PRIMARY KEY (terminal_id, window_start_ms, window_end_ms)
     )`
  ).run();
}

/**
 * Record a session as mined. Idempotent: re-marking the same key keeps the
 * original mined_at_ms (first-mined wins) so the watermark is a stable audit
 * point.
 */
export function markSessionMined(key: MinedSessionKey, nowMs?: number): void {
  const db = getTelemetryDb();
  ensureTable(db);
  const minedAtMs = nowMs ?? Date.now();
  db.prepare(
    `INSERT INTO firehose_mined_sessions
       (terminal_id, window_start_ms, window_end_ms, mined_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (terminal_id, window_start_ms, window_end_ms) DO NOTHING`
  ).run(key.terminalId, key.windowStartMs, key.windowEndMs, minedAtMs);
}

/** Whether this exact `(terminal, window)` has already been mined. */
export function isSessionMined(key: MinedSessionKey): boolean {
  const db = getTelemetryDb();
  ensureTable(db);
  const row = db
    .prepare(
      `SELECT 1 FROM firehose_mined_sessions
        WHERE terminal_id = ? AND window_start_ms = ? AND window_end_ms = ?
        LIMIT 1`
    )
    .get(key.terminalId, key.windowStartMs, key.windowEndMs);
  return row !== undefined;
}

/**
 * Clear the watermark table (test isolation, mirrors resetTelemetryDbForTests).
 */
export function resetFirehoseMiningStateForTests(): void {
  const db = getTelemetryDb();
  ensureTable(db);
  db.prepare('DELETE FROM firehose_mined_sessions').run();
}
