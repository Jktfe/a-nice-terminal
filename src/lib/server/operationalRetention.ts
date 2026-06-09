import { statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { getDbFilePath, getIdentityDb } from './db';

export const DEFAULT_OPERATIONAL_RETENTION_DAYS = 7;
export const DEFAULT_OPERATIONAL_RETENTION_MAX_DB_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_WAL_CHECKPOINT_MIN_BYTES = 1024 * 1024 * 1024;
// Safety bounds — prevent pathological env values from thrashing or disabling hygiene.
const MAX_RETENTION_DAYS = 365;
const MIN_MAX_DB_BYTES = 10 * 1024 * 1024; // 10 MB
const MIN_WAL_CHECKPOINT_BYTES = 1;
const MIN_SWEEP_INTERVAL_MS = 60_000; // 1 minute
const MAX_BATCH_SIZE = 500_000;
const DEFAULT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 50_000;
const BOOT_KEY = '__antOperationalRetentionBooted';
const INITIAL_TIMER_KEY = '__antOperationalRetentionInitialTimer';
const TIMER_KEY = '__antOperationalRetentionTimer';
const THRESHOLD_INITIAL_TIMER_KEY = '__antOperationalRetentionThresholdInitialTimer';
const THRESHOLD_TIMER_KEY = '__antOperationalRetentionThresholdTimer';
const LAST_RESULT_KEY = '__antOperationalRetentionLastResult';
const LAST_WAL_CHECKPOINT_KEY = '__antOperationalRetentionLastWalCheckpoint';
const WAL_CHECKPOINT_CHILD_RUNNING_KEY = '__antOperationalRetentionWalCheckpointChildRunning';

const WAL_CHECKPOINT_CHILD_SCRIPT = `
import Database from 'better-sqlite3';
import { statSync } from 'node:fs';

const dbPath = process.env.ANT_WAL_CHECKPOINT_DB_PATH;
const attemptedAtMs = Number(process.env.ANT_WAL_CHECKPOINT_NOW_MS || Date.now());
const size = (path) => {
  try { return statSync(path).size; } catch { return 0; }
};
const walPath = \`\${dbPath}-wal\`;
const walBytesBefore = size(walPath);
let pragmaResult = null;
let errorMessage = null;
let pruned = null;
const deleteInBatches = (db, tableName, timestampColumn, cutoffMs, batchSize) => {
  let deleted = 0;
  while (true) {
    const result = db.prepare(\`DELETE FROM \${tableName}
      WHERE rowid IN (
        SELECT rowid FROM \${tableName}
         WHERE \${timestampColumn} < ?
         LIMIT ?
      )\`).run(cutoffMs, batchSize);
    const changes = Number(result.changes);
    deleted += changes;
    if (changes < batchSize) break;
  }
  return deleted;
};
try {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  if (process.env.ANT_WAL_CHECKPOINT_PRUNE === '1') {
    const retentionDays = Math.max(1, Math.min(365, Number(process.env.ANT_OPERATIONAL_RETENTION_DAYS || 7) || 7));
    const cutoffMs = attemptedAtMs - retentionDays * 24 * 60 * 60 * 1000;
    const batchSize = 50000;
    const terminalRunEventsDeleted = deleteInBatches(db, 'terminal_run_events', 'ts_ms', cutoffMs, batchSize);
    const cliHookEventsDeleted = deleteInBatches(db, 'cli_hook_events', 'received_at_ms', cutoffMs, batchSize);
    const terminalRecordsDeleted = db.prepare(\`DELETE FROM terminal_records
       WHERE (superseded_at_ms IS NOT NULL OR session_id NOT IN (SELECT id FROM terminals))
         AND COALESCE(superseded_at_ms, updated_at_ms) < ?\`).run(cutoffMs).changes;
    pruned = {
      retentionDays,
      cutoffMs,
      terminalRunEventsDeleted,
      cliHookEventsDeleted,
      terminalRecordsDeleted
    };
  }
  pragmaResult = db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
}
const walBytesAfter = size(walPath);
console.log(JSON.stringify({
  attemptedAtMs,
  walPath,
  walBytesBefore,
  walBytesAfter,
  fullyTruncated: walBytesAfter === 0,
  shrank: walBytesAfter < walBytesBefore,
  pragmaResult,
  pruned,
  errorMessage
}));
`;

export type OperationalRetentionResult = {
  retentionDays: number;
  cutoffMs: number;
  terminalRunEventsDeleted: number;
  cliHookEventsDeleted: number;
  terminalRecordsDeleted: number;
  vacuumed: boolean;
  trigger: 'manual' | 'scheduled' | 'threshold';
  dbBytesBefore: number;
  dbBytesAfter: number;
  maxDbBytes: number;
};

export type WalCheckpointResult = {
  attemptedAtMs: number;
  walPath: string;
  walBytesBefore: number;
  walBytesAfter: number;
  fullyTruncated: boolean;
  shrank: boolean;
  pragmaResult: unknown;
  errorMessage: string | null;
};

export type WalCheckpointChildStartResult = {
  started: boolean;
  alreadyRunning: boolean;
  skipped: boolean;
  walBytesBefore: number;
  minWalBytes: number;
};

type BootResult = {
  booted: boolean;
  disabled: boolean;
};

export function getOperationalRetentionDays(): number {
  const raw = process.env.ANT_OPERATIONAL_RETENTION_DAYS;
  if (!raw) return DEFAULT_OPERATIONAL_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_OPERATIONAL_RETENTION_DAYS;
  return Math.min(parsed, MAX_RETENTION_DAYS);
}

export function getOperationalRetentionMaxDbBytes(): number {
  const raw = process.env.ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES;
  if (!raw) return DEFAULT_OPERATIONAL_RETENTION_MAX_DB_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_OPERATIONAL_RETENTION_MAX_DB_BYTES;
  return Math.max(parsed, MIN_MAX_DB_BYTES);
}

export function getWalCheckpointMinBytes(): number {
  const raw = process.env.ANT_WAL_CHECKPOINT_MIN_BYTES;
  if (!raw) return DEFAULT_WAL_CHECKPOINT_MIN_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_WAL_CHECKPOINT_MIN_BYTES;
  return Math.max(parsed, MIN_WAL_CHECKPOINT_BYTES);
}

export function getOperationalRetentionPolicy(): {
  retentionDays: number;
  sweepIntervalMs: number;
  thresholdCheckIntervalMs: number;
  maxDbBytes: number;
  walCheckpointMinBytes: number;
  disabled: boolean;
  lastResult: OperationalRetentionResult | null;
  lastWalCheckpoint: WalCheckpointResult | null;
} {
  return {
    retentionDays: getOperationalRetentionDays(),
    sweepIntervalMs: getSweepIntervalMs(),
    thresholdCheckIntervalMs: getThresholdCheckIntervalMs(),
    maxDbBytes: getOperationalRetentionMaxDbBytes(),
    walCheckpointMinBytes: getWalCheckpointMinBytes(),
    disabled: process.env.ANT_OPERATIONAL_RETENTION_DISABLED === '1',
    lastResult: ((globalThis as Record<string, unknown>)[LAST_RESULT_KEY] as OperationalRetentionResult | undefined) ?? null,
    lastWalCheckpoint: ((globalThis as Record<string, unknown>)[LAST_WAL_CHECKPOINT_KEY] as WalCheckpointResult | undefined) ?? null
  };
}

export function pruneOperationalHistory(input: {
  nowMs?: number;
  retentionDays?: number;
  batchSize?: number;
  vacuum?: boolean;
  trigger?: OperationalRetentionResult['trigger'];
} = {}): OperationalRetentionResult {
  const retentionDays = input.retentionDays ?? getOperationalRetentionDays();
  const nowMs = input.nowMs ?? Date.now();
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(input.batchSize ?? DEFAULT_BATCH_SIZE)));
  const db = getIdentityDb();
  const dbBytesBefore = operationalDbBytes();

  const terminalRunEventsDeleted = deleteInBatches({
    tableName: 'terminal_run_events',
    timestampColumn: 'ts_ms',
    cutoffMs,
    batchSize
  });
  const cliHookEventsDeleted = deleteInBatches({
    tableName: 'cli_hook_events',
    timestampColumn: 'received_at_ms',
    cutoffMs,
    batchSize
  });
  // Age out dead terminal_records (spec 2026-05-31): a record is removed only
  // when it is dead (superseded — replaced/archived — OR orphaned, no backing
  // terminal) AND aged past the same retention cutoff. Age = superseded_at_ms
  // when present, else updated_at_ms. Recent/live records are preserved.
  // terminal_records is bounded (tens-to-hundreds of rows); no batch loop needed.
  const terminalRecordsDeleted = db.prepare(
    `DELETE FROM terminal_records
       WHERE (superseded_at_ms IS NOT NULL OR session_id NOT IN (SELECT id FROM terminals))
         AND COALESCE(superseded_at_ms, updated_at_ms) < ?`
  ).run(cutoffMs).changes;
  const deletedTotal = terminalRunEventsDeleted + cliHookEventsDeleted + terminalRecordsDeleted;
  const shouldVacuum = input.vacuum === true && deletedTotal > 0;
  if (shouldVacuum) {
    checkpointWalTruncate();
    db.exec('VACUUM');
  }
  const result = {
    retentionDays,
    cutoffMs,
    terminalRunEventsDeleted,
    cliHookEventsDeleted,
    terminalRecordsDeleted,
    vacuumed: shouldVacuum,
    trigger: input.trigger ?? 'manual',
    dbBytesBefore,
    dbBytesAfter: operationalDbBytes(),
    maxDbBytes: getOperationalRetentionMaxDbBytes()
  };
  (globalThis as Record<string, unknown>)[LAST_RESULT_KEY] = result;
  return result;
}

export function pruneOperationalHistoryIfOverThreshold(input: {
  nowMs?: number;
  maxDbBytes?: number;
  retentionDays?: number;
  batchSize?: number;
  vacuum?: boolean;
} = {}): OperationalRetentionResult | null {
  const maxDbBytes = input.maxDbBytes ?? getOperationalRetentionMaxDbBytes();
  if (operationalDbBytes() < maxDbBytes) return null;
  return pruneOperationalHistory({
    nowMs: input.nowMs,
    retentionDays: input.retentionDays,
    batchSize: input.batchSize,
    vacuum: input.vacuum ?? true,
    trigger: 'threshold'
  });
}

/**
 * Truncating WAL checkpoint. SQLite's autocheckpoint runs PASSIVE — it flushes
 * WAL pages into the main DB but never shrinks the `-wal` FILE. Under the
 * fleet's high terminal_run_events write rate (~100 events/sec of PTY output)
 * that let the WAL grow unbounded — ~1GB every ~13 min, an audited corruption /
 * disk-fill risk (2026-06-07). Running TRUNCATE on the existing 5-min threshold
 * timer keeps the `-wal` file bounded to a few minutes of frames.
 *
 * Safe by construction: a checkpoint can never corrupt the DB — the risk was
 * NOT checkpointing. If a reader pins old frames, TRUNCATE partial-checkpoints
 * and the file is reclaimed on a later pass. Best-effort: never throws.
 */
export function checkpointWalTruncate(input: {
  dbPath?: string;
  nowMs?: number;
  runCheckpoint?: () => unknown;
} = {}): WalCheckpointResult {
  const dbPath = input.dbPath ?? getDbFilePath();
  const walPath = `${dbPath}-wal`;
  const attemptedAtMs = input.nowMs ?? Date.now();
  const walBytesBefore = fileSizeBytes(walPath);
  let pragmaResult: unknown = null;
  let errorMessage: string | null = null;
  try {
    pragmaResult = input.runCheckpoint
      ? input.runCheckpoint()
      : getIdentityDb().pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    /* checkpoint is best-effort maintenance; never crash the sweep */
  }
  const walBytesAfter = fileSizeBytes(walPath);
  const result: WalCheckpointResult = {
    attemptedAtMs,
    walPath,
    walBytesBefore,
    walBytesAfter,
    fullyTruncated: walBytesAfter === 0,
    shrank: walBytesAfter < walBytesBefore,
    pragmaResult,
    errorMessage
  };
  (globalThis as Record<string, unknown>)[LAST_WAL_CHECKPOINT_KEY] = result;
  return result;
}

export function checkpointWalTruncateInChild(input: {
  dbPath?: string;
  nowMs?: number;
  minWalBytes?: number;
  force?: boolean;
  pruneOperationalRows?: boolean;
  spawnImpl?: typeof spawn;
} = {}): WalCheckpointChildStartResult {
  const slot = globalThis as Record<string, unknown>;
  const dbPath = input.dbPath ?? getDbFilePath();
  const walPath = `${dbPath}-wal`;
  const walBytesBefore = fileSizeBytes(walPath);
  const minWalBytes = Math.max(MIN_WAL_CHECKPOINT_BYTES, Math.floor(input.minWalBytes ?? getWalCheckpointMinBytes()));
  if (input.force !== true && walBytesBefore < minWalBytes) {
    return {
      started: false,
      alreadyRunning: false,
      skipped: true,
      walBytesBefore,
      minWalBytes
    };
  }
  if (slot[WAL_CHECKPOINT_CHILD_RUNNING_KEY]) {
    return {
      started: false,
      alreadyRunning: true,
      skipped: false,
      walBytesBefore,
      minWalBytes
    };
  }
  slot[WAL_CHECKPOINT_CHILD_RUNNING_KEY] = true;
  const nowMs = input.nowMs ?? Date.now();
  const spawnImpl = input.spawnImpl ?? spawn;
  const child = spawnImpl(process.execPath, ['--input-type=module', '-e', WAL_CHECKPOINT_CHILD_SCRIPT], {
    env: {
      ...process.env,
      ANT_WAL_CHECKPOINT_DB_PATH: dbPath,
      ANT_WAL_CHECKPOINT_NOW_MS: String(nowMs),
      ANT_WAL_CHECKPOINT_PRUNE: input.pruneOperationalRows === true ? '1' : '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => { stdout += chunk; });
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  const finishWithError = (message: string) => {
    const walPath = `${dbPath}-wal`;
    const walBytesAfter = fileSizeBytes(walPath);
    const result: WalCheckpointResult = {
      attemptedAtMs: nowMs,
      walPath,
      walBytesBefore: walBytesAfter,
      walBytesAfter,
      fullyTruncated: walBytesAfter === 0,
      shrank: false,
      pragmaResult: null,
      errorMessage: message
    };
    slot[LAST_WAL_CHECKPOINT_KEY] = result;
  };
  child.on('error', (error) => {
    delete slot[WAL_CHECKPOINT_CHILD_RUNNING_KEY];
    finishWithError(error instanceof Error ? error.message : String(error));
  });
  child.on('close', () => {
    delete slot[WAL_CHECKPOINT_CHILD_RUNNING_KEY];
    try {
      const parsed = JSON.parse(stdout.trim()) as WalCheckpointResult;
      slot[LAST_WAL_CHECKPOINT_KEY] = parsed;
    } catch (error) {
      const parseMessage = error instanceof Error ? error.message : String(error);
      finishWithError(stderr.trim() || parseMessage);
    }
  });
  return {
    started: true,
    alreadyRunning: false,
    skipped: false,
    walBytesBefore,
    minWalBytes
  };
}

export function ensureOperationalRetentionSweepBooted(input: {
  runImmediately?: boolean;
  initialDelayMs?: number;
  intervalMs?: number;
  thresholdInitialDelayMs?: number;
  thresholdCheckIntervalMs?: number;
} = {}): BootResult {
  if (process.env.ANT_OPERATIONAL_RETENTION_DISABLED === '1') {
    return { booted: false, disabled: true };
  }
  const slot = globalThis as Record<string, unknown>;
  if (slot[BOOT_KEY]) return { booted: false, disabled: false };
  slot[BOOT_KEY] = true;

  const runSweep = () => {
    checkpointWalTruncateInChild();
  };
  const runThresholdCheck = () => {
    // Bound the -wal file out-of-process. Synchronous SQLite maintenance in
    // this server blocks health/chat while readers pin the WAL.
    checkpointWalTruncateInChild();
  };

  if (input.runImmediately !== false) {
    const initialTimer = setTimeout(runSweep, Math.max(0, input.initialDelayMs ?? 30_000));
    if (typeof initialTimer.unref === 'function') initialTimer.unref();
    slot[INITIAL_TIMER_KEY] = initialTimer;
  }
  const intervalMs = Math.max(1, Math.floor(input.intervalMs ?? getSweepIntervalMs()));
  const timer = setInterval(runSweep, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  slot[TIMER_KEY] = timer;
  const thresholdInitialDelayMs = input.thresholdInitialDelayMs
    ?? (input.runImmediately === false ? undefined : input.initialDelayMs ?? 30_000);
  if (thresholdInitialDelayMs !== undefined) {
    const thresholdInitialTimer = setTimeout(runThresholdCheck, Math.max(0, thresholdInitialDelayMs));
    if (typeof thresholdInitialTimer.unref === 'function') thresholdInitialTimer.unref();
    slot[THRESHOLD_INITIAL_TIMER_KEY] = thresholdInitialTimer;
  }
  const thresholdIntervalMs = Math.max(
    1,
    Math.floor(input.thresholdCheckIntervalMs ?? getThresholdCheckIntervalMs())
  );
  const thresholdTimer = setInterval(runThresholdCheck, thresholdIntervalMs);
  if (typeof thresholdTimer.unref === 'function') thresholdTimer.unref();
  slot[THRESHOLD_TIMER_KEY] = thresholdTimer;
  return { booted: true, disabled: false };
}

export function _resetOperationalRetentionBootForTests(): void {
  const slot = globalThis as Record<string, unknown>;
  const initialTimer = slot[INITIAL_TIMER_KEY] as NodeJS.Timeout | undefined;
  const timer = slot[TIMER_KEY] as NodeJS.Timeout | undefined;
  const thresholdInitialTimer = slot[THRESHOLD_INITIAL_TIMER_KEY] as NodeJS.Timeout | undefined;
  const thresholdTimer = slot[THRESHOLD_TIMER_KEY] as NodeJS.Timeout | undefined;
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  if (thresholdInitialTimer) clearTimeout(thresholdInitialTimer);
  if (thresholdTimer) clearInterval(thresholdTimer);
  delete slot[BOOT_KEY];
  delete slot[INITIAL_TIMER_KEY];
  delete slot[TIMER_KEY];
  delete slot[THRESHOLD_INITIAL_TIMER_KEY];
  delete slot[THRESHOLD_TIMER_KEY];
  delete slot[LAST_RESULT_KEY];
  delete slot[LAST_WAL_CHECKPOINT_KEY];
  delete slot[WAL_CHECKPOINT_CHILD_RUNNING_KEY];
}

function getSweepIntervalMs(): number {
  const raw = process.env.ANT_OPERATIONAL_RETENTION_SWEEP_INTERVAL_MS;
  if (!raw) return DEFAULT_SWEEP_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_SWEEP_INTERVAL_MS;
  return Math.max(parsed, MIN_SWEEP_INTERVAL_MS);
}

function getThresholdCheckIntervalMs(): number {
  const raw = process.env.ANT_OPERATIONAL_RETENTION_THRESHOLD_CHECK_INTERVAL_MS;
  if (!raw) return DEFAULT_THRESHOLD_CHECK_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_THRESHOLD_CHECK_INTERVAL_MS;
  return Math.max(parsed, MIN_SWEEP_INTERVAL_MS);
}

function fileSizeBytes(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

function operationalDbBytes(): number {
  const dbPath = getDbFilePath();
  return fileSizeBytes(dbPath) + fileSizeBytes(`${dbPath}-wal`) + fileSizeBytes(`${dbPath}-shm`);
}

function deleteInBatches(input: {
  tableName: 'terminal_run_events' | 'cli_hook_events';
  timestampColumn: 'ts_ms' | 'received_at_ms';
  cutoffMs: number;
  batchSize: number;
}): number {
  const db = getIdentityDb();
  let deleted = 0;
  while (true) {
    const result = db
      .prepare(
        `DELETE FROM ${input.tableName}
          WHERE rowid IN (
            SELECT rowid FROM ${input.tableName}
             WHERE ${input.timestampColumn} < ?
             LIMIT ?
          )`
      )
      .run(input.cutoffMs, input.batchSize);
    const changes = Number(result.changes);
    deleted += changes;
    if (changes < input.batchSize) break;
  }
  return deleted;
}
