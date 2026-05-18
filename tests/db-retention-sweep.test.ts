import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { shouldSkipForThreshold, sweepDatabase } from '../scripts/db-retention-sweep';

const requireFromHere = createRequire(import.meta.url);
const Database = requireFromHere('better-sqlite3');

const NOW = Date.UTC(2026, 4, 18, 12, 0, 0);
const OLD = NOW - 8 * 24 * 60 * 60 * 1000;
const FRESH = NOW - 2 * 24 * 60 * 60 * 1000;

let tempDir = '';

function openFixtureDb() {
  tempDir = mkdtempSync(join(tmpdir(), 'ant-retention-sweep-'));
  const dbPath = join(tempDir, 'ant.db');
  const db = new Database(dbPath);
  return { db, dbPath };
}

function sqliteDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', '');
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('db-retention-sweep', () => {
  it('prunes known high-growth event tables while preserving durable run_events kinds', () => {
    const { db, dbPath } = openFixtureDb();
    db.exec(`
      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY,
        ts_ms INTEGER NOT NULL,
        kind TEXT NOT NULL
      );
      CREATE TABLE terminal_run_events (
        id INTEGER PRIMARY KEY,
        created_at_ms INTEGER NOT NULL,
        payload TEXT DEFAULT '{}'
      );
      CREATE TABLE cli_hook_events (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL,
        payload TEXT DEFAULT '{}'
      );
    `);

    db.prepare('INSERT INTO run_events (ts_ms, kind) VALUES (?, ?)').run(OLD, 'command_block');
    db.prepare('INSERT INTO run_events (ts_ms, kind) VALUES (?, ?)').run(OLD, 'plan_milestone');
    db.prepare('INSERT INTO run_events (ts_ms, kind) VALUES (?, ?)').run(FRESH, 'terminal_tick');
    db.prepare('INSERT INTO terminal_run_events (created_at_ms) VALUES (?)').run(OLD);
    db.prepare('INSERT INTO terminal_run_events (created_at_ms) VALUES (?)').run(FRESH);
    db.prepare('INSERT INTO cli_hook_events (created_at) VALUES (?)').run(sqliteDate(OLD));
    db.prepare('INSERT INTO cli_hook_events (created_at) VALUES (?)').run(sqliteDate(FRESH));

    const summary = sweepDatabase(db, dbPath, {
      dryRun: false,
      days: 7,
      vacuum: false,
      batchSize: 1,
    }, NOW);

    expect(summary.totalEligible).toBe(3);
    expect(summary.totalDeleted).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_events').get().n).toBe(2);
    expect(db.prepare('SELECT kind FROM run_events ORDER BY kind').all()).toEqual([
      { kind: 'plan_milestone' },
      { kind: 'terminal_tick' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM terminal_run_events').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cli_hook_events').get().n).toBe(1);
  });

  it('reports missing optional event tables without failing the sweep', () => {
    const { db, dbPath } = openFixtureDb();
    db.exec(`
      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY,
        ts_ms INTEGER NOT NULL,
        kind TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO run_events (ts_ms, kind) VALUES (?, ?)').run(OLD, 'command_block');

    const summary = sweepDatabase(db, dbPath, {
      dryRun: true,
      days: 7,
      vacuum: false,
      batchSize: 5000,
    }, NOW);

    expect(summary.totalEligible).toBe(1);
    expect(summary.totalDeleted).toBe(0);
    expect(summary.tables.find((table) => table.table === 'terminal_run_events')?.status).toBe('missing');
    expect(summary.tables.find((table) => table.table === 'cli_hook_events')?.status).toBe('missing');
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_events').get().n).toBe(1);
  });

  it('skips pruning when the DB is below the configured size threshold', () => {
    const { db, dbPath } = openFixtureDb();
    db.exec(`
      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY,
        ts_ms INTEGER NOT NULL,
        kind TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO run_events (ts_ms, kind) VALUES (?, ?)').run(OLD, 'command_block');

    const summary = sweepDatabase(db, dbPath, {
      dryRun: false,
      days: 7,
      vacuum: false,
      maxSizeMb: 512,
      batchSize: 5000,
    }, NOW);

    expect(shouldSkipForThreshold(summary.sizeBefore, 512)).toBe(true);
    expect(summary.skippedByThreshold).toBe(true);
    expect(summary.totalEligible).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_events').get().n).toBe(1);
  });
});
