import { statSync } from 'node:fs';
import { getDbFilePath, getIdentityDb } from './db';

export const DEFAULT_OPERATIONAL_RETENTION_DAYS = 7;
export const DEFAULT_OPERATIONAL_RETENTION_MAX_DB_BYTES = 1024 * 1024 * 1024;
// Safety bounds — prevent pathological env values from thrashing or disabling hygiene.
const MAX_RETENTION_DAYS = 365;
const MIN_MAX_DB_BYTES = 10 * 1024 * 1024; // 10 MB
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

export type OperationalRetentionResult = {
  retentionDays: number;
  cutoffMs: number;
  terminalRunEventsDeleted: number;
  cliHookEventsDeleted: number;
  vacuumed: boolean;
  trigger: 'manual' | 'scheduled' | 'threshold';
  dbBytesBefore: number;
  dbBytesAfter: number;
  maxDbBytes: number;
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

export function getOperationalRetentionPolicy(): {
  retentionDays: number;
  sweepIntervalMs: number;
  thresholdCheckIntervalMs: number;
  maxDbBytes: number;
  disabled: boolean;
  lastResult: OperationalRetentionResult | null;
} {
  return {
    retentionDays: getOperationalRetentionDays(),
    sweepIntervalMs: getSweepIntervalMs(),
    thresholdCheckIntervalMs: getThresholdCheckIntervalMs(),
    maxDbBytes: getOperationalRetentionMaxDbBytes(),
    disabled: process.env.ANT_OPERATIONAL_RETENTION_DISABLED === '1',
    lastResult: ((globalThis as Record<string, unknown>)[LAST_RESULT_KEY] as OperationalRetentionResult | undefined) ?? null
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
  const deletedTotal = terminalRunEventsDeleted + cliHookEventsDeleted;
  const shouldVacuum = input.vacuum === true && deletedTotal > 0;
  if (shouldVacuum) {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
  }
  const result = {
    retentionDays,
    cutoffMs,
    terminalRunEventsDeleted,
    cliHookEventsDeleted,
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
} = {}): OperationalRetentionResult | null {
  const maxDbBytes = input.maxDbBytes ?? getOperationalRetentionMaxDbBytes();
  if (operationalDbBytes() < maxDbBytes) return null;
  return pruneOperationalHistory({
    nowMs: input.nowMs,
    retentionDays: input.retentionDays,
    batchSize: input.batchSize,
    vacuum: true,
    trigger: 'threshold'
  });
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
    try {
      pruneOperationalHistory({ vacuum: false, trigger: 'scheduled' });
    } catch {
      /* retention is best-effort; do not crash the server */
    }
  };
  const runThresholdCheck = () => {
    try {
      pruneOperationalHistoryIfOverThreshold();
    } catch {
      /* threshold pruning is best-effort; do not crash the server */
    }
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
