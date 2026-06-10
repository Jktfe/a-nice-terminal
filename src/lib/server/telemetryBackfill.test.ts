import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { backfillTelemetry, backfillTelemetryTableBatch } from './telemetryBackfill';

type DB = ReturnType<typeof Database>;

const RUN_COLS = `id INTEGER PRIMARY KEY AUTOINCREMENT, terminal_id TEXT, ts_ms INTEGER,
  source TEXT, trust TEXT, kind TEXT, text TEXT, payload TEXT, raw_ref TEXT,
  transcript_event_id TEXT, deleted_at_ms INTEGER`;
const HOOK_COLS = `id INTEGER PRIMARY KEY AUTOINCREMENT, source_cli TEXT, session_id TEXT,
  hook_event_name TEXT, received_at_ms INTEGER, transcript_path TEXT, cwd TEXT,
  permission_mode TEXT, effort_level TEXT, tool_name TEXT, tool_use_id TEXT, payload TEXT`;

let db: DB | null = null;

function makeDb(): DB {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE terminal_run_events (${RUN_COLS})`);
  d.exec(`CREATE TABLE cli_hook_events (${HOOK_COLS})`);
  d.exec(`ATTACH ':memory:' AS tel`);
  d.exec(`CREATE TABLE tel.terminal_run_events (${RUN_COLS})`);
  d.exec(`CREATE UNIQUE INDEX tel.uq_tre ON terminal_run_events (terminal_id, transcript_event_id)
            WHERE transcript_event_id IS NOT NULL`);
  d.exec(`CREATE TABLE tel.cli_hook_events (${HOOK_COLS})`);
  return d;
}

function addRun(d: DB, terminalId: string, tsMs: number, text: string, tid: string | null = null): void {
  d.prepare(
    `INSERT INTO terminal_run_events (terminal_id, ts_ms, source, trust, kind, text, payload, transcript_event_id)
     VALUES (?, ?, 'pty', 'raw', 'message', ?, '{}', ?)`
  ).run(terminalId, tsMs, text, tid);
}

afterEach(() => {
  try { db?.close(); } catch { /* ignore */ }
  db = null;
});

describe('backfillTelemetry', () => {
  it('moves every row from source into tel and empties the source', () => {
    db = makeDb();
    for (let i = 0; i < 5; i++) addRun(db, 't1', 1000 + i, `row${i}`);
    db.prepare(
      `INSERT INTO cli_hook_events (source_cli, session_id, hook_event_name, received_at_ms, payload)
       VALUES ('claude-code', 's1', 'SessionStart', 2000, '{}')`
    ).run();

    const totals = backfillTelemetry(db, { batchSize: 2 });

    expect(totals).toEqual([
      { table: 'terminal_run_events', moved: 5 },
      { table: 'cli_hook_events', moved: 1 }
    ]);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM terminal_run_events`).get() as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM tel.terminal_run_events`).get() as { n: number }).n).toBe(5);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM tel.cli_hook_events`).get() as { n: number }).n).toBe(1);
  });

  it('is resumable — re-running after a partial drain finishes the rest', () => {
    db = makeDb();
    for (let i = 0; i < 10; i++) addRun(db, 't1', 1000 + i, `row${i}`);
    // One batch only (simulate an interrupted run).
    backfillTelemetryTableBatch(
      db,
      {
        name: 'terminal_run_events',
        cols: 'terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref, transcript_event_id, deleted_at_ms',
        orIgnore: true
      },
      3
    );
    expect((db.prepare(`SELECT COUNT(*) AS n FROM terminal_run_events`).get() as { n: number }).n).toBe(7);
    // Resume.
    backfillTelemetry(db, { batchSize: 4 });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM terminal_run_events`).get() as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM tel.terminal_run_events`).get() as { n: number }).n).toBe(10);
  });

  it('dedups a transcript id already present in tel (post-cutover row wins)', () => {
    db = makeDb();
    // A post-cutover row already in tel with a transcript id.
    db.prepare(
      `INSERT INTO tel.terminal_run_events (terminal_id, ts_ms, source, trust, kind, text, payload, transcript_event_id)
       VALUES ('t1', 5000, 'transcript', 'high', 'message', 'NEW', '{}', 'evt#1')`
    ).run();
    // The OLD duplicate still in the source identity DB.
    addRun(db, 't1', 1000, 'OLD', 'evt#1');

    backfillTelemetry(db, { batchSize: 10 });

    const rows = db
      .prepare(`SELECT text FROM tel.terminal_run_events WHERE terminal_id = 't1' AND transcript_event_id = 'evt#1'`)
      .all() as Array<{ text: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('NEW'); // the post-cutover row was kept
    expect((db.prepare(`SELECT COUNT(*) AS n FROM terminal_run_events`).get() as { n: number }).n).toBe(0);
  });

  it('reports progress per batch', () => {
    db = makeDb();
    for (let i = 0; i < 6; i++) addRun(db, 't1', 1000 + i, `row${i}`);
    const seen: number[] = [];
    backfillTelemetry(db, { batchSize: 2, onProgress: (p) => { if (p.table === 'terminal_run_events') seen.push(p.remaining); } });
    expect(seen).toEqual([4, 2, 0]); // 6 → 4 → 2 → 0 across three batches
  });
});
