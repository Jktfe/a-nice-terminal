import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getTelemetryDb,
  resetTelemetryDbForTests,
  telemetrySidecarEnabled
} from './telemetryDb';

const PREV_FLAG = process.env.ANT_TELEMETRY_SIDECAR;

beforeEach(() => {
  resetTelemetryDbForTests();
});

afterEach(() => {
  resetTelemetryDbForTests();
  if (PREV_FLAG === undefined) delete process.env.ANT_TELEMETRY_SIDECAR;
  else process.env.ANT_TELEMETRY_SIDECAR = PREV_FLAG;
});

describe('telemetryDb', () => {
  it('creates the firehose tables on first open', () => {
    const db = getTelemetryDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('terminal_run_events');
    expect(names).toContain('cli_hook_events');
  });

  it('round-trips a terminal_run_events row', () => {
    const db = getTelemetryDb();
    db.prepare(
      `INSERT INTO terminal_run_events (terminal_id, ts_ms, kind, text) VALUES (?, ?, ?, ?)`
    ).run('t1', 1000, 'message', 'hello');
    const row = db
      .prepare(`SELECT terminal_id, kind, text FROM terminal_run_events WHERE terminal_id = ?`)
      .get('t1') as { terminal_id: string; kind: string; text: string };
    expect(row).toMatchObject({ terminal_id: 't1', kind: 'message', text: 'hello' });
  });

  it('reset isolates between tests (no row bleed)', () => {
    const db = getTelemetryDb();
    const count = db.prepare(`SELECT COUNT(*) AS n FROM terminal_run_events`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('telemetrySidecarEnabled reflects the env flag (default off)', () => {
    delete process.env.ANT_TELEMETRY_SIDECAR;
    expect(telemetrySidecarEnabled()).toBe(false);
    process.env.ANT_TELEMETRY_SIDECAR = 'on';
    expect(telemetrySidecarEnabled()).toBe(true);
    process.env.ANT_TELEMETRY_SIDECAR = 'off';
    expect(telemetrySidecarEnabled()).toBe(false);
  });
});
