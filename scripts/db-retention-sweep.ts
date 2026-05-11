#!/usr/bin/env bun
/**
 * C1 of main-app-improvements-2026-05-10 — DB retention sweep + VACUUM.
 *
 * The ant.db file had ballooned past 8GB on the host during the
 * 2026-05-09 audit, almost entirely from accumulated run_events. This
 * script prunes run_events older than 7 days while preserving the
 * kinds we want to keep forever (plan_* events are the source of
 * truth for plan state; error/* keeps a debugging trail).
 *
 * Run modes:
 *   bun scripts/db-retention-sweep.ts             # full sweep + VACUUM
 *   bun scripts/db-retention-sweep.ts --dry-run   # report only, no writes
 *   bun scripts/db-retention-sweep.ts --days 14   # custom retention window
 *   bun scripts/db-retention-sweep.ts --no-vacuum # prune only, skip VACUUM
 *
 * Safe to run on a live ANT install: better-sqlite3 holds an exclusive
 * lock only during VACUUM. The DELETE runs in chunks of 5000 to keep
 * the lock window small.
 */

import { statSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

// Resolve the same DB path the server uses, but open our own
// connection — ops scripts should not share the live server's
// better-sqlite3 instance.
const ANT_DATA_DIR = process.env.ANT_DATA_DIR || join(process.env.HOME || '/tmp', '.ant-v3');
const ANT_DB_PATH = join(ANT_DATA_DIR, 'ant.db');

function getAntDbPath(): string {
  return ANT_DB_PATH;
}

const requireFromHere = createRequire(import.meta.url);
type SqliteDatabase = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => { changes?: number };
  };
};

function openDb(): SqliteDatabase {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
  if (isBun) {
    const { Database } = requireFromHere('bun:sqlite');
    return new Database(ANT_DB_PATH) as SqliteDatabase;
  }
  const Database = requireFromHere('better-sqlite3');
  return new Database(ANT_DB_PATH) as SqliteDatabase;
}

const KEEP_KINDS = new Set([
  'plan_section',
  'plan_decision',
  'plan_milestone',
  'plan_acceptance',
  'plan_test',
  'error',
  'error_event',
]);

interface SweepOptions {
  dryRun: boolean;
  days: number;
  vacuum: boolean;
}

function parseArgs(argv: string[]): SweepOptions {
  const opts: SweepOptions = { dryRun: false, days: 7, vacuum: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--days' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) opts.days = n;
    } else if (arg === '--no-vacuum') opts.vacuum = false;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: bun scripts/db-retention-sweep.ts [--dry-run] [--days N] [--no-vacuum]');
      process.exit(0);
    }
  }
  return opts;
}

function fmtBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 2)} ${units[i]}`;
}

function dbSize(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const path = getAntDbPath();
  const sizeBefore = dbSize(path);
  const cutoffMs = Date.now() - opts.days * 24 * 60 * 60 * 1000;

  console.log(`ANT DB retention sweep`);
  console.log(`  path:       ${path}`);
  console.log(`  size:       ${fmtBytes(sizeBefore)}`);
  console.log(`  retention:  ${opts.days} days (cutoff ${new Date(cutoffMs).toISOString()})`);
  console.log(`  vacuum:     ${opts.vacuum ? 'yes' : 'no'}`);
  console.log(`  dry-run:    ${opts.dryRun ? 'yes' : 'no'}`);
  console.log('');

  const db = openDb();

  // Build the WHERE for both count and delete. We exclude any KEEP_KINDS
  // even when older than the cutoff — plan events live forever, errors
  // live forever.
  const keepKinds = Array.from(KEEP_KINDS);
  const placeholders = keepKinds.map(() => '?').join(',');
  const where = `ts_ms < ? AND kind NOT IN (${placeholders})`;

  const countRow = db.prepare(`SELECT COUNT(*) AS n FROM run_events WHERE ${where}`).get(cutoffMs, ...keepKinds) as { n: number };
  console.log(`Eligible to prune: ${countRow.n.toLocaleString()} run_events older than ${opts.days}d (excl. ${keepKinds.length} preserved kinds).`);

  if (countRow.n === 0) {
    console.log('Nothing to do.');
    if (opts.vacuum && !opts.dryRun) {
      console.log('Running VACUUM anyway in case of prior pruning...');
      db.prepare('VACUUM').run();
      console.log(`Size after VACUUM: ${fmtBytes(dbSize(path))}`);
    }
    return;
  }

  if (opts.dryRun) {
    console.log('Dry run — no writes.');
    return;
  }

  // Delete in chunks to keep the WAL small and the lock window short.
  const BATCH = 5000;
  let deleted = 0;
  const deleteStmt = db.prepare(
    `DELETE FROM run_events WHERE id IN (SELECT id FROM run_events WHERE ${where} LIMIT ${BATCH})`,
  );
  while (true) {
    const info = deleteStmt.run(cutoffMs, ...keepKinds);
    const n = info.changes ?? 0;
    if (n === 0) break;
    deleted += n;
    if (deleted % (BATCH * 10) === 0) process.stdout.write(`  ...deleted ${deleted.toLocaleString()}\n`);
  }
  console.log(`Deleted ${deleted.toLocaleString()} run_events.`);

  const sizeMid = dbSize(path);
  console.log(`Size before VACUUM: ${fmtBytes(sizeMid)}  (was ${fmtBytes(sizeBefore)}, ${fmtBytes(sizeBefore - sizeMid)} reclaimed from page allocations)`);

  if (opts.vacuum) {
    console.log('VACUUM (this may take a minute)...');
    const t0 = Date.now();
    db.prepare('VACUUM').run();
    const t1 = Date.now();
    const sizeAfter = dbSize(path);
    console.log(`VACUUM complete in ${((t1 - t0) / 1000).toFixed(1)}s`);
    console.log(`Final size: ${fmtBytes(sizeAfter)}  (total reclaimed: ${fmtBytes(sizeBefore - sizeAfter)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
