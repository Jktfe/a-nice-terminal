/**
 * usageSnapshotStore — read/write helpers for the `usage_snapshots`
 * append-only table (JWPK msg_4rbn05cztw antV4 2026-05-28).
 *
 * The poller writes one row per successful daemon fetch. The history
 * endpoint reads recent rows for the trend view on /terminals.
 *
 * payload_json is the serialised UsagePayload from $lib/usage/types,
 * so both the trend chart and the live strip can share the typed
 * shape without duplicate parsing logic.
 */
import { randomUUID } from 'crypto';
import { getIdentityDb } from './db';
import type { UsagePayload } from '$lib/usage/types';

export type UsageSnapshotRow = {
  id: string;
  capturedAtMs: number;
  payload: UsagePayload;
};

/** Insert a snapshot row. The poller calls this only after a
 *  successful daemon fetch (i.e. `payload.daemonReachable === true`);
 *  storing failure ticks would muddy the trend lines. */
export function insertUsageSnapshot(payload: UsagePayload): UsageSnapshotRow {
  const db = getIdentityDb();
  const id = randomUUID();
  const capturedAtMs = Date.now();
  db.prepare(
    `INSERT INTO usage_snapshots (id, captured_at_ms, payload_json)
     VALUES (?, ?, ?)`
  ).run(id, capturedAtMs, JSON.stringify(payload));
  return { id, capturedAtMs, payload };
}

/** Return the most recent N snapshots newest-first. Capped at 360 rows
 *  (≈ 180 days at the 12-hour cadence) so a typo can't pull the whole
 *  table into memory. */
export function listRecentUsageSnapshots(limit: number): UsageSnapshotRow[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 360);
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT id, captured_at_ms, payload_json
       FROM usage_snapshots
       ORDER BY captured_at_ms DESC
       LIMIT ?`
    )
    .all(safeLimit) as Array<{ id: string; captured_at_ms: number; payload_json: string }>;
  const result: UsageSnapshotRow[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as UsagePayload;
      result.push({ id: row.id, capturedAtMs: row.captured_at_ms, payload });
    } catch {
      // Skip malformed rows rather than crash the whole history feed.
      // A future migration could re-parse + repair, but for the trend
      // chart a missing tick is acceptable.
    }
  }
  return result;
}

/** Test helper: wipe all snapshot rows so each test starts clean. */
export function resetUsageSnapshotStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM usage_snapshots`).run();
}
