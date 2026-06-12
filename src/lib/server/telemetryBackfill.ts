/**
 * telemetryBackfill — drains the existing firehose rows from the identity DB
 * into the telemetry sidecar (Phase 2 of the move-out). Runs OUT-OF-PROCESS
 * (see scripts/backfill-telemetry-sidecar.mjs) so it never blocks the server.
 *
 * Crash-safety: the telemetry DB is ATTACHed as `tel` on the SAME connection
 * as the source, so each batch's copy + delete run in ONE transaction — a row
 * is moved exactly once, or not at all. No cross-process duplicate window, so
 * the store dual-read (which merges identity + telemetry) never double-counts.
 * Resumable: a batch deletes what it copied, so re-running continues from
 * what's left.
 *
 * Never prunes — this MOVES the asset, it does not delete it
 * (project_firehose_is_an_asset_mine_before_prune).
 */

import type Database from 'better-sqlite3';

type DB = ReturnType<typeof Database>;

export type BackfillTable = { name: string; cols: string; orIgnore: boolean };

// Column lists exclude `id` (AUTOINCREMENT) so the destination assigns its own
// — ids are internal and not relied on across files (the dual-read merges by
// timestamp). The order matches the telemetry-DB schema.
const BACKFILL_TABLES: BackfillTable[] = [
  {
    name: 'terminal_run_events',
    cols: 'terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref, transcript_event_id, deleted_at_ms',
    // The partial unique index on (terminal_id, transcript_event_id) means a
    // post-cutover row may already hold a transcript id; OR IGNORE keeps that
    // one and drops the old duplicate (correct idempotent dedup).
    orIgnore: true
  },
  {
    name: 'cli_hook_events',
    cols: 'source_cli, session_id, hook_event_name, received_at_ms, transcript_path, cwd, permission_mode, effort_level, tool_name, tool_use_id, payload',
    orIgnore: false
  }
];

export type BackfillProgress = { table: string; moved: number; remaining: number };

function countRemaining(db: DB, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** Move one batch (the `batchSize` smallest ids) of a table, atomically. */
export function backfillTelemetryTableBatch(db: DB, table: BackfillTable, batchSize: number): number {
  const ids = db
    .prepare(`SELECT id FROM ${table.name} ORDER BY id ASC LIMIT ?`)
    .all(batchSize) as Array<{ id: number }>;
  if (ids.length === 0) return 0;
  const minId = ids[0].id;
  const maxId = ids[ids.length - 1].id;
  const verb = table.orIgnore ? 'INSERT OR IGNORE' : 'INSERT';
  const move = db.transaction(() => {
    db.prepare(
      `${verb} INTO tel.${table.name} (${table.cols})
         SELECT ${table.cols} FROM ${table.name} WHERE id BETWEEN ? AND ?`
    ).run(minId, maxId);
    db.prepare(`DELETE FROM ${table.name} WHERE id BETWEEN ? AND ?`).run(minId, maxId);
  });
  // IMMEDIATE: take the write lock up front. A deferred tx starts as a read
  // and upgrades to write at the INSERT — if the live server wrote to the
  // hot DB in between, the upgrade dies with SQLITE_BUSY_SNAPSHOT (seen on
  // the first prod drain, 2026-06-12, ~950k rows in). With IMMEDIATE the
  // busy_timeout does the waiting instead, and the snapshot can't go stale.
  move.immediate();
  return ids.length;
}

/**
 * Drain both firehose tables from the source (identity) DB into the ATTACHed
 * `tel` (telemetry) DB. `db` MUST already have the telemetry DB attached as
 * `tel` with its schema present. Returns per-table totals moved.
 */
export function backfillTelemetry(
  db: DB,
  opts: { batchSize?: number; onProgress?: (p: BackfillProgress) => void } = {}
): Array<{ table: string; moved: number }> {
  const batchSize = Math.max(1, opts.batchSize ?? 50_000);
  const totals: Array<{ table: string; moved: number }> = [];
  for (const table of BACKFILL_TABLES) {
    let moved = 0;
    let busyRetries = 0;
    for (;;) {
      let n: number;
      try {
        n = backfillTelemetryTableBatch(db, table, batchSize);
        busyRetries = 0;
      } catch (cause) {
        const code = (cause as { code?: string }).code ?? '';
        // Transient writer contention with the live server: back off and
        // retry the SAME batch (per-batch atomicity means nothing moved).
        if ((code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT') && busyRetries < 10) {
          busyRetries += 1;
          opts.onProgress?.({ table: table.name, moved, remaining: -busyRetries });
          continue;
        }
        throw cause;
      }
      if (n === 0) break;
      moved += n;
      opts.onProgress?.({ table: table.name, moved, remaining: countRemaining(db, table.name) });
    }
    totals.push({ table: table.name, moved });
  }
  return totals;
}
