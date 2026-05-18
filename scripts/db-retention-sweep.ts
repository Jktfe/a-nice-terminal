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
 *   bun scripts/db-retention-sweep.ts --if-size-over-mb 1024
 *
 * Safe to run on a live ANT install: better-sqlite3 holds an exclusive
 * lock only during VACUUM. The DELETE runs in chunks of 5000 to keep
 * the lock window small.
 */

import { fileURLToPath } from 'url';
import { statSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

// Resolve the same DB path the server uses, but open our own
// connection — ops scripts should not share the live server's
// better-sqlite3 instance.
const ANT_DATA_DIR = process.env.ANT_DATA_DIR || join(process.env.HOME || '/tmp', '.ant-v3');
const ANT_DB_PATH = process.env.ANT_DB_PATH || join(ANT_DATA_DIR, 'ant.db');

function getAntDbPath(): string {
  return ANT_DB_PATH;
}

const requireFromHere = createRequire(import.meta.url);
type SqliteDatabase = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => { changes?: number };
    all?: (...params: unknown[]) => unknown[];
  };
  exec: (sql: string) => void;
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
  maxSizeMb?: number;
  batchSize: number;
}

interface RetentionTableSpec {
  name: string;
  timestampColumns: string[];
  preserveKinds?: Set<string>;
}

interface TableSweepSummary {
  table: string;
  status: 'swept' | 'missing' | 'no_timestamp_column';
  timestampColumn?: string;
  eligible: number;
  deleted: number;
}

interface SweepSummary {
  dbPath: string;
  sizeBefore: number;
  sizeAfter?: number;
  skippedByThreshold: boolean;
  thresholdBytes?: number;
  cutoffMs: number;
  tables: TableSweepSummary[];
  totalEligible: number;
  totalDeleted: number;
}

function parseArgs(argv: string[]): SweepOptions {
  const envThreshold = Number(process.env.ANT_RETENTION_MAX_DB_MB || '');
  const opts: SweepOptions = {
    dryRun: false,
    days: 7,
    vacuum: true,
    maxSizeMb: Number.isFinite(envThreshold) && envThreshold > 0 ? envThreshold : undefined,
    batchSize: 5000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--days' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) opts.days = n;
    } else if ((arg === '--if-size-over-mb' || arg === '--max-size-mb') && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) opts.maxSizeMb = n;
    } else if (arg === '--batch-size' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) opts.batchSize = Math.floor(n);
    } else if (arg === '--no-vacuum') opts.vacuum = false;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: bun scripts/db-retention-sweep.ts [--dry-run] [--days N] [--no-vacuum] [--if-size-over-mb N] [--batch-size N]');
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

const RETENTION_TABLES: RetentionTableSpec[] = [
  {
    name: 'run_events',
    timestampColumns: ['ts_ms', 'created_at_ms', 'createdAtMs', 'created_at'],
    preserveKinds: KEEP_KINDS,
  },
  {
    name: 'terminal_run_events',
    timestampColumns: ['ts_ms', 'created_at_ms', 'createdAtMs', 'created_at'],
  },
  {
    name: 'cli_hook_events',
    timestampColumns: ['ts_ms', 'created_at_ms', 'createdAtMs', 'created_at'],
  },
];

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function thresholdBytes(maxSizeMb?: number): number | undefined {
  if (!maxSizeMb || maxSizeMb <= 0) return undefined;
  return maxSizeMb * 1024 * 1024;
}

export function shouldSkipForThreshold(sizeBytes: number, maxSizeMb?: number): boolean {
  const maxBytes = thresholdBytes(maxSizeMb);
  return maxBytes !== undefined && sizeBytes <= maxBytes;
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

function tableColumns(db: SqliteDatabase, tableName: string): Array<{ name: string; type: string }> {
  const stmt = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return (stmt.all?.() ?? []) as Array<{ name: string; type: string }>;
}

function findTimestampColumn(
  columns: Array<{ name: string; type: string }>,
  candidates: string[],
): { name: string; type: string } | undefined {
  for (const candidate of candidates) {
    const found = columns.find((column) => column.name === candidate);
    if (found) return found;
  }
  return undefined;
}

function timestampPredicate(column: { name: string; type: string }): string {
  const quoted = quoteIdentifier(column.name);
  const type = column.type.toUpperCase();
  if (type.includes('INT') || type.includes('REAL') || type.includes('NUM')) {
    return `${quoted} < ?`;
  }
  return `CAST(strftime('%s', ${quoted}) AS INTEGER) * 1000 < ?`;
}

function retentionWhere(
  columns: Array<{ name: string; type: string }>,
  timestampColumn: { name: string; type: string },
  spec: RetentionTableSpec,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses = [timestampPredicate(timestampColumn)];
  params.push('__cutoff__');

  if (spec.preserveKinds && columns.some((column) => column.name === 'kind')) {
    const kinds = Array.from(spec.preserveKinds);
    const placeholders = kinds.map(() => '?').join(',');
    clauses.push(`"kind" NOT IN (${placeholders})`);
    params.push(...kinds);
  }

  return { sql: clauses.join(' AND '), params };
}

function paramsWithCutoff(params: unknown[], cutoffMs: number): unknown[] {
  return params.map((param) => (param === '__cutoff__' ? cutoffMs : param));
}

export function sweepDatabase(
  db: SqliteDatabase,
  dbPath: string,
  opts: SweepOptions,
  nowMs = Date.now(),
): SweepSummary {
  const sizeBefore = dbSize(dbPath);
  const maxBytes = thresholdBytes(opts.maxSizeMb);
  const cutoffMs = nowMs - opts.days * 24 * 60 * 60 * 1000;
  const summary: SweepSummary = {
    dbPath,
    sizeBefore,
    skippedByThreshold: shouldSkipForThreshold(sizeBefore, opts.maxSizeMb),
    thresholdBytes: maxBytes,
    cutoffMs,
    tables: [],
    totalEligible: 0,
    totalDeleted: 0,
  };

  if (summary.skippedByThreshold) {
    summary.sizeAfter = sizeBefore;
    return summary;
  }

  for (const spec of RETENTION_TABLES) {
    if (!tableExists(db, spec.name)) {
      summary.tables.push({ table: spec.name, status: 'missing', eligible: 0, deleted: 0 });
      continue;
    }

    const columns = tableColumns(db, spec.name);
    const timestampColumn = findTimestampColumn(columns, spec.timestampColumns);
    if (!timestampColumn) {
      summary.tables.push({ table: spec.name, status: 'no_timestamp_column', eligible: 0, deleted: 0 });
      continue;
    }

    const where = retentionWhere(columns, timestampColumn, spec);
    const whereParams = paramsWithCutoff(where.params, cutoffMs);
    const tableName = quoteIdentifier(spec.name);
    const countRow = db.prepare(`SELECT COUNT(*) AS n FROM ${tableName} WHERE ${where.sql}`).get(...whereParams) as { n: number };
    let deleted = 0;

    if (!opts.dryRun && countRow.n > 0) {
      const deleteStmt = db.prepare(
        `DELETE FROM ${tableName} WHERE rowid IN (SELECT rowid FROM ${tableName} WHERE ${where.sql} LIMIT ${opts.batchSize})`,
      );
      while (true) {
        const info = deleteStmt.run(...whereParams);
        const n = info.changes ?? 0;
        if (n === 0) break;
        deleted += n;
      }
    }

    summary.tables.push({
      table: spec.name,
      status: 'swept',
      timestampColumn: timestampColumn.name,
      eligible: countRow.n,
      deleted,
    });
    summary.totalEligible += countRow.n;
    summary.totalDeleted += deleted;
  }

  if (!opts.dryRun && opts.vacuum && summary.totalDeleted > 0) {
    db.exec('VACUUM');
  }
  summary.sizeAfter = dbSize(dbPath);
  return summary;
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
  if (opts.maxSizeMb) {
    console.log(`  threshold:  only sweep when DB > ${opts.maxSizeMb} MB`);
  }
  console.log('');

  const db = openDb();
  const summary = sweepDatabase(db, path, opts);

  if (summary.skippedByThreshold) {
    console.log(`DB size ${fmtBytes(sizeBefore)} is at/below threshold ${fmtBytes(summary.thresholdBytes ?? 0)}. Skipping prune.`);
    return;
  }

  for (const table of summary.tables) {
    if (table.status === 'missing') {
      console.log(`${table.table}: table missing, skipped.`);
      continue;
    }
    if (table.status === 'no_timestamp_column') {
      console.log(`${table.table}: no known timestamp column, skipped.`);
      continue;
    }
    const action = opts.dryRun ? 'eligible' : 'deleted';
    const count = opts.dryRun ? table.eligible : table.deleted;
    console.log(`${table.table}: ${count.toLocaleString()} ${action} older than ${opts.days}d via ${table.timestampColumn}.`);
  }

  if (summary.totalEligible === 0) {
    console.log('Nothing eligible to prune.');
  }

  if (opts.dryRun) {
    console.log('Dry run — no writes.');
  } else {
    console.log(`Deleted ${summary.totalDeleted.toLocaleString()} rows across event tables.`);
    if (opts.vacuum && summary.totalDeleted > 0) {
      console.log(`VACUUM complete. Final size: ${fmtBytes(summary.sizeAfter ?? dbSize(path))}  (total reclaimed: ${fmtBytes(sizeBefore - (summary.sizeAfter ?? sizeBefore))})`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
