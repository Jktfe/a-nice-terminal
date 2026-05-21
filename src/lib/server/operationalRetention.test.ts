import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { insertCliHookEvent } from './cliHookEventsStore';
import {
  DEFAULT_OPERATIONAL_RETENTION_DAYS,
  getOperationalRetentionDays,
  getOperationalRetentionMaxDbBytes,
  getOperationalRetentionPolicy,
  pruneOperationalHistory,
  pruneOperationalHistoryIfOverThreshold,
  _resetOperationalRetentionBootForTests,
  ensureOperationalRetentionSweepBooted
} from './operationalRetention';

describe('operationalRetention', () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    vi.useRealTimers();
    resetIdentityDbForTests();
    _resetOperationalRetentionBootForTests();
    tempDir = mkdtempSync(join(tmpdir(), 'ant-operational-retention-'));
    process.env.ANT_FRESH_DB_PATH = join(tempDir, 'fresh-ant.db');
    delete process.env.ANT_OPERATIONAL_RETENTION_DAYS;
    delete process.env.ANT_OPERATIONAL_RETENTION_SWEEP_INTERVAL_MS;
    delete process.env.ANT_OPERATIONAL_RETENTION_THRESHOLD_CHECK_INTERVAL_MS;
    delete process.env.ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES;
    delete process.env.ANT_OPERATIONAL_RETENTION_DISABLED;
  });

  afterEach(() => {
    vi.useRealTimers();
    resetIdentityDbForTests();
    _resetOperationalRetentionBootForTests();
    delete process.env.ANT_FRESH_DB_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it('defaults retention to 7 days and accepts positive integer env override', () => {
    expect(DEFAULT_OPERATIONAL_RETENTION_DAYS).toBe(7);
    expect(getOperationalRetentionDays()).toBe(7);
    process.env.ANT_OPERATIONAL_RETENTION_DAYS = '14';
    expect(getOperationalRetentionDays()).toBe(14);
    process.env.ANT_OPERATIONAL_RETENTION_DAYS = '0';
    expect(getOperationalRetentionDays()).toBe(7);
  });

  it('defaults max DB bytes and accepts a positive integer override', () => {
    expect(getOperationalRetentionMaxDbBytes()).toBe(1024 * 1024 * 1024);
    process.env.ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES = '20971520';
    expect(getOperationalRetentionMaxDbBytes()).toBe(20_971_520);
    process.env.ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES = '0';
    expect(getOperationalRetentionMaxDbBytes()).toBe(1024 * 1024 * 1024);
  });

  it('hard-deletes terminal_run_events and cli_hook_events older than cutoff in batches', () => {
    const nowMs = Date.now();
    const oldMs = nowMs - 8 * 24 * 60 * 60 * 1000;
    appendTerminalRunEvent({ terminalId: 't-old', kind: 'message', text: 'old', tsMs: oldMs });
    appendTerminalRunEvent({ terminalId: 't-new', kind: 'message', text: 'new', tsMs: nowMs });
    insertCliHookEvent({
      sessionId: 's-old',
      hookEventName: 'PreToolUse',
      receivedAtMs: oldMs,
      payload: { old: true }
    });
    insertCliHookEvent({
      sessionId: 's-new',
      hookEventName: 'PreToolUse',
      receivedAtMs: nowMs,
      payload: { old: false }
    });

    const result = pruneOperationalHistory({ nowMs, batchSize: 1, vacuum: false });

    expect(result.retentionDays).toBe(7);
    expect(result.trigger).toBe('manual');
    expect(result.terminalRunEventsDeleted).toBe(1);
    expect(result.cliHookEventsDeleted).toBe(1);
    expect(
      getIdentityDb().prepare(`SELECT text FROM terminal_run_events ORDER BY text`).all()
    ).toEqual([{ text: 'new' }]);
    expect(
      getIdentityDb().prepare(`SELECT session_id FROM cli_hook_events ORDER BY session_id`).all()
    ).toEqual([{ session_id: 's-new' }]);
  });

  it('runs a vacuuming threshold prune only when the DB exceeds the configured ceiling', () => {
    const nowMs = Date.now();
    const oldMs = nowMs - 8 * 24 * 60 * 60 * 1000;
    appendTerminalRunEvent({
      terminalId: 't-threshold-old',
      kind: 'message',
      text: 'old threshold event',
      tsMs: oldMs
    });

    expect(pruneOperationalHistoryIfOverThreshold({ nowMs, maxDbBytes: Number.MAX_SAFE_INTEGER })).toBeNull();

    const result = pruneOperationalHistoryIfOverThreshold({ nowMs, maxDbBytes: 1 });

    expect(result).not.toBeNull();
    expect(result?.trigger).toBe('threshold');
    expect(result?.vacuumed).toBe(true);
    expect(result?.terminalRunEventsDeleted).toBe(1);
  });

  it('surfaces retention policy and the latest result for diagnostics', () => {
    process.env.ANT_OPERATIONAL_RETENTION_DAYS = '3';
    process.env.ANT_OPERATIONAL_RETENTION_SWEEP_INTERVAL_MS = '120000';
    process.env.ANT_OPERATIONAL_RETENTION_THRESHOLD_CHECK_INTERVAL_MS = '120000';
    process.env.ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES = '10485760';

    const result = pruneOperationalHistory({ trigger: 'scheduled' });
    const policy = getOperationalRetentionPolicy();

    expect(policy.retentionDays).toBe(3);
    expect(policy.sweepIntervalMs).toBe(120000);
    expect(policy.thresholdCheckIntervalMs).toBe(120000);
    expect(policy.maxDbBytes).toBe(10485760);
    expect(policy.lastResult).toEqual(result);
  });

  it('boots one sweep timer and honours the disabled flag', () => {
    vi.useFakeTimers();
    process.env.ANT_OPERATIONAL_RETENTION_SWEEP_INTERVAL_MS = '1000';
    process.env.ANT_OPERATIONAL_RETENTION_THRESHOLD_CHECK_INTERVAL_MS = '120000';
    const first = ensureOperationalRetentionSweepBooted({ runImmediately: false });
    const second = ensureOperationalRetentionSweepBooted({ runImmediately: false });
    expect(first.booted).toBe(true);
    expect(second.booted).toBe(false);

    _resetOperationalRetentionBootForTests();
    process.env.ANT_OPERATIONAL_RETENTION_DISABLED = '1';
    const disabled = ensureOperationalRetentionSweepBooted({ runImmediately: false });
    expect(disabled.booted).toBe(false);
    expect(disabled.disabled).toBe(true);
  });

  it('runs a startup threshold prune when the DB already exceeds the ceiling', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
    const oldMs = nowMs - 8 * 24 * 60 * 60 * 1000;
    appendTerminalRunEvent({
      terminalId: 't-big-old',
      kind: 'message',
      text: 'x'.repeat(11 * 1024 * 1024),
      tsMs: oldMs
    });
    process.env.ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES = String(10 * 1024 * 1024);

    ensureOperationalRetentionSweepBooted({
      runImmediately: false,
      thresholdInitialDelayMs: 0,
      thresholdCheckIntervalMs: 120000
    });

    await vi.advanceTimersByTimeAsync(0);

    const policy = getOperationalRetentionPolicy();
    expect(policy.lastResult).toMatchObject({
      trigger: 'threshold',
      vacuumed: true,
      terminalRunEventsDeleted: 1
    });
    expect(
      getIdentityDb().prepare(`SELECT COUNT(*) AS n FROM terminal_run_events`).get()
    ).toEqual({ n: 0 });
  });

  it('caps retention days at MAX_RETENTION_DAYS', () => {
    process.env.ANT_OPERATIONAL_RETENTION_DAYS = '1000';
    expect(getOperationalRetentionDays()).toBe(365);
  });

  it('enforces minimum maxDbBytes of 10MB', () => {
    process.env.ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES = '1024';
    expect(getOperationalRetentionMaxDbBytes()).toBe(10 * 1024 * 1024);
  });

  it('caps batch size at MAX_BATCH_SIZE', () => {
    const nowMs = Date.now();
    const oldMs = nowMs - 8 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 10; i++) {
      appendTerminalRunEvent({ terminalId: `t-${i}`, kind: 'message', text: `old-${i}`, tsMs: oldMs });
    }
    // batchSize 1_000_000 should be capped to 500_000, so all 10 rows deleted in one batch
    const result = pruneOperationalHistory({ nowMs, batchSize: 1_000_000, vacuum: false });
    expect(result.terminalRunEventsDeleted).toBe(10);
  });

});
