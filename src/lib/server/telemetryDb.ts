/**
 * telemetryDb — the sidecar SQLite file that holds the high-volume telemetry
 * firehose (`terminal_run_events`, `cli_hook_events`) OUT of the hot
 * identity/chat database (`fresh-ant.db`).
 *
 * Why (audit finding A, JWPK 2026-06-10): ~100 PTY events/sec wrote to the
 * same file as chat + identity, so the firehose's WAL growth + checkpoints
 * caused 1.5-7s read stalls and "database is locked" on chat sends. Giving the
 * firehose its own file (own WAL, own checkpoint) removes that contention
 * without deleting anything — the firehose is a transcript ASSET to be mined
 * later, never pruned to fix performance.
 *
 * Rollout is gated by ANT_TELEMETRY_SIDECAR (off|on, default off) so merging
 * this code changes nothing until prod deliberately flips it. See
 * docs/superpowers/specs/2026-06-10-telemetry-sidecar-design.md.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

type DatabaseInstance = ReturnType<typeof Database>;

const DB_GLOBAL_KEY = '__antTelemetryDb';

/** Whether the telemetry sidecar is active. Off → every store stays on the
 *  identity DB exactly as before (safe default for an undeployed flip). */
export function telemetrySidecarEnabled(): boolean {
  return (process.env.ANT_TELEMETRY_SIDECAR ?? 'off').trim().toLowerCase() === 'on';
}

/**
 * Resolve the telemetry DB file path. Precedence: explicit
 * ANT_TELEMETRY_DB_PATH → a per-worker temp sibling under vitest → a sibling
 * of fresh-ant.db (`~/.ant/telemetry.db`). The vitest sibling mirrors the
 * identity DB's per-worker isolation so telemetry rows never bleed across
 * worker processes.
 */
export function resolveTelemetryDbFilePath(): string {
  const explicit = process.env.ANT_TELEMETRY_DB_PATH;
  if (explicit && explicit.length > 0) return explicit;
  if (process.env.VITEST) {
    const workerId = process.env.VITEST_WORKER_ID ?? '0';
    return join('/tmp', `ant-vitest-telemetry-${workerId}-${process.pid}.db`);
  }
  const home = process.env.HOME ?? '/tmp';
  return join(home, '.ant', 'telemetry.db');
}

// Self-contained schema for the sidecar. The terminal_run_events ALTER columns
// (transcript_event_id, deleted_at_ms) are folded into the CREATE since this is
// a fresh table with no migration-ordering history. Behaviour-preserving copy
// of the identity-DB DDL — no schema improvements in the move.
const TELEMETRY_DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS terminal_run_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    terminal_id         TEXT NOT NULL,
    ts_ms               INTEGER NOT NULL,
    source              TEXT NOT NULL DEFAULT 'pty',
    trust               TEXT NOT NULL DEFAULT 'raw' CHECK (trust IN ('high','medium','raw')),
    kind                TEXT NOT NULL,
    text                TEXT DEFAULT '',
    payload             TEXT DEFAULT '{}',
    raw_ref             TEXT,
    transcript_event_id TEXT,
    deleted_at_ms       INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_term_run_events_terminal_ts ON terminal_run_events (terminal_id, ts_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_term_run_events_ts ON terminal_run_events (ts_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_term_run_events_kind ON terminal_run_events (kind)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_term_run_events_transcript_id
     ON terminal_run_events (terminal_id, transcript_event_id)
     WHERE transcript_event_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS cli_hook_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source_cli        TEXT NOT NULL DEFAULT 'claude-code',
    session_id        TEXT NOT NULL,
    hook_event_name   TEXT NOT NULL,
    received_at_ms    INTEGER NOT NULL,
    transcript_path   TEXT,
    cwd               TEXT,
    permission_mode   TEXT,
    effort_level      TEXT,
    tool_name         TEXT,
    tool_use_id       TEXT,
    payload           TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cli_hook_events_session_ts
     ON cli_hook_events (session_id, received_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cli_hook_events_event_ts
     ON cli_hook_events (hook_event_name, received_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cli_hook_events_source_ts
     ON cli_hook_events (source_cli, received_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cli_hook_events_received_at ON cli_hook_events (received_at_ms)`
];

function applyTelemetrySchema(db: DatabaseInstance): void {
  for (const ddl of TELEMETRY_DDL_STATEMENTS) {
    db.prepare(ddl).run();
  }
}

/** The sidecar telemetry DB handle (global-cached, like getIdentityDb). */
export function getTelemetryDb(): DatabaseInstance {
  const globalSlot = globalThis as Record<string, unknown>;
  const existing = globalSlot[DB_GLOBAL_KEY] as DatabaseInstance | undefined;
  if (existing) return existing;

  const dbFile = resolveTelemetryDbFilePath();
  mkdirSync(dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -64000');
  applyTelemetrySchema(db);
  globalSlot[DB_GLOBAL_KEY] = db;
  return db;
}

/** The DB file path, for the retention WAL-checkpoint child to target. */
export function getTelemetryDbFilePath(): string {
  return resolveTelemetryDbFilePath();
}

/** Close + delete the sidecar (test-scoped paths only — never a real file). */
export function resetTelemetryDbForTests(): void {
  const globalSlot = globalThis as Record<string, unknown>;
  const existing = globalSlot[DB_GLOBAL_KEY] as DatabaseInstance | undefined;
  if (existing) {
    try { existing.close(); } catch { /* may already be closed */ }
  }
  delete globalSlot[DB_GLOBAL_KEY];

  const dbFile = resolveTelemetryDbFilePath();
  const isVitestTempScope = /\/ant-vitest-telemetry-[^/]+\.db$/.test(dbFile);
  const isExplicitTestPath =
    Boolean(process.env.ANT_TELEMETRY_DB_PATH) && process.env.VITEST === 'true';
  if (!isVitestTempScope && !isExplicitTestPath) return;
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${dbFile}${suffix}`;
    if (existsSync(path)) {
      try { rmSync(path, { force: true }); } catch { /* best-effort cleanup */ }
    }
  }
}
