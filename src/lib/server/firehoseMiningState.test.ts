import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTelemetryDb, resetTelemetryDbForTests } from './telemetryDb';
import {
  isSessionMined,
  markSessionMined,
  resetFirehoseMiningStateForTests,
  type MinedSessionKey
} from './firehoseMiningState';

beforeEach(() => {
  resetTelemetryDbForTests();
});

afterEach(() => {
  resetTelemetryDbForTests();
});

const KEY: MinedSessionKey = { terminalId: 't1', windowStartMs: 1000, windowEndMs: 2000 };

describe('firehoseMiningState', () => {
  it('creates the firehose_mined_sessions table on the telemetry DB', () => {
    // Touching the module via markSessionMined ensures the table is created.
    markSessionMined(KEY);
    const db = getTelemetryDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain('firehose_mined_sessions');
  });

  it('marks a session mined and reports it as mined', () => {
    expect(isSessionMined(KEY)).toBe(false);
    markSessionMined(KEY);
    expect(isSessionMined(KEY)).toBe(true);
  });

  it('treats a different window of the same terminal as not mined', () => {
    markSessionMined(KEY);
    expect(isSessionMined({ terminalId: 't1', windowStartMs: 5000, windowEndMs: 6000 })).toBe(false);
    expect(isSessionMined({ terminalId: 't1', windowStartMs: 1000, windowEndMs: 9999 })).toBe(false);
  });

  it('treats a different terminal with the same window as not mined', () => {
    markSessionMined(KEY);
    expect(isSessionMined({ terminalId: 't2', windowStartMs: 1000, windowEndMs: 2000 })).toBe(false);
  });

  it('is idempotent — re-marking the same key does not throw', () => {
    markSessionMined(KEY);
    expect(() => markSessionMined(KEY)).not.toThrow();
    expect(isSessionMined(KEY)).toBe(true);
  });

  it('records mined_at_ms, defaulting to now and honouring an explicit value', () => {
    markSessionMined(KEY, 1234567890);
    const db = getTelemetryDb();
    const row = db
      .prepare(
        `SELECT terminal_id, window_start_ms, window_end_ms, mined_at_ms
           FROM firehose_mined_sessions
          WHERE terminal_id = ? AND window_start_ms = ? AND window_end_ms = ?`
      )
      .get(KEY.terminalId, KEY.windowStartMs, KEY.windowEndMs) as {
      terminal_id: string;
      window_start_ms: number;
      window_end_ms: number;
      mined_at_ms: number;
    };
    expect(row).toMatchObject({
      terminal_id: 't1',
      window_start_ms: 1000,
      window_end_ms: 2000,
      mined_at_ms: 1234567890
    });
  });

  it('re-marking does NOT overwrite the original mined_at_ms', () => {
    markSessionMined(KEY, 1000);
    markSessionMined(KEY, 9999);
    const db = getTelemetryDb();
    const row = db
      .prepare(
        `SELECT mined_at_ms FROM firehose_mined_sessions
          WHERE terminal_id = ? AND window_start_ms = ? AND window_end_ms = ?`
      )
      .get(KEY.terminalId, KEY.windowStartMs, KEY.windowEndMs) as { mined_at_ms: number };
    expect(row.mined_at_ms).toBe(1000);
  });

  it('resetForTests clears the watermark table', () => {
    markSessionMined(KEY);
    expect(isSessionMined(KEY)).toBe(true);
    resetFirehoseMiningStateForTests();
    expect(isSessionMined(KEY)).toBe(false);
  });
});
