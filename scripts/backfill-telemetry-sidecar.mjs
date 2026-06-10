#!/usr/bin/env bun
/**
 * backfill-telemetry-sidecar — Phase 2 of the telemetry move-out. Drains the
 * existing firehose rows (terminal_run_events, cli_hook_events) from the
 * identity DB into the telemetry sidecar, OUT-OF-PROCESS so it never blocks
 * the live server. Run with bun (imports the tested TS core).
 *
 *   ANT_FRESH_DB_PATH=~/.ant/fresh-ant.db \
 *   ANT_TELEMETRY_DB_PATH=~/.ant/telemetry.db \
 *   bun scripts/backfill-telemetry-sidecar.mjs [--batch 50000]
 *
 * Crash-safe + resumable: each batch's copy+delete is one transaction on a
 * connection with the telemetry DB ATTACHed as `tel`, so a row is moved
 * exactly once. Safe to Ctrl-C and re-run. Never deletes data — it MOVES the
 * firehose asset (project_firehose_is_an_asset_mine_before_prune). After it
 * reports 0 remaining, VACUUM the identity DB (separately) to reclaim space.
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { applyTelemetrySchema } from '../src/lib/server/telemetryDb.ts';
import { backfillTelemetry } from '../src/lib/server/telemetryBackfill.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const identityPath = process.env.ANT_FRESH_DB_PATH || join(homedir(), '.ant', 'fresh-ant.db');
const telemetryPath = process.env.ANT_TELEMETRY_DB_PATH || join(homedir(), '.ant', 'telemetry.db');
const batchSize = Math.max(1, Number(arg('--batch', '50000')) || 50000);

console.log(`[backfill] identity=${identityPath}`);
console.log(`[backfill] telemetry=${telemetryPath}`);
console.log(`[backfill] batchSize=${batchSize}`);

// 1. Ensure the telemetry DB has its schema (a normal connection that we close
//    before attaching the same file to the identity connection).
const telSchemaDb = new Database(telemetryPath);
telSchemaDb.pragma('journal_mode = WAL');
applyTelemetrySchema(telSchemaDb);
telSchemaDb.close();

// 2. Open identity, ATTACH telemetry as `tel`, drain in batches.
const db = new Database(identityPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.prepare('ATTACH DATABASE ? AS tel').run(telemetryPath);

const start = Date.now();
const totals = backfillTelemetry(db, {
  batchSize,
  onProgress: ({ table, moved, remaining }) => {
    console.log(`[backfill] ${table}: moved=${moved} remaining=${remaining}`);
  }
});
db.close();

const secs = ((Date.now() - start) / 1000).toFixed(1);
console.log(`[backfill] done in ${secs}s:`, totals);
console.log('[backfill] firehose moved to the sidecar. Next: VACUUM the identity DB out-of-process to reclaim disk.');
