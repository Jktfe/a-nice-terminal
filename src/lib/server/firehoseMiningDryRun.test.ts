/**
 * firehoseMiningDryRun tests — firehose MINING PASS (2026-06-10).
 *
 * The --dry-run backbone: it runs the selector + reconstruction (size only, no
 * writes, no LLM extraction) and summarises candidate count + a rough transcript
 * byte estimate + a per-signal tally, so scope/cost is visible before a real run.
 *
 * Fixture rows go directly into the telemetry sidecar via getTelemetryDb so the
 * tests exercise the same store the mining pass reads. Per-worker isolation
 * comes from resetTelemetryDbForTests (telemetry sidecar pattern); the watermark
 * is reset alongside it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTelemetryDb, resetTelemetryDbForTests } from './telemetryDb';
import { markSessionMined, resetFirehoseMiningStateForTests } from './firehoseMiningState';
import { selectHighSignalSessions } from './firehoseSelector';
import { reconstructSession } from './sessionReconstruct';
import { firehoseMiningDryRun } from './firehoseMiningDryRun';

const MIN = 60 * 1000;

function insertRunEvent(opts: {
  terminalId: string;
  tsMs: number;
  kind: string;
  text?: string;
}): void {
  getTelemetryDb()
    .prepare(
      `INSERT INTO terminal_run_events (terminal_id, ts_ms, source, trust, kind, text)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.terminalId,
      opts.tsMs,
      'pty',
      opts.kind === 'raw' ? 'raw' : 'medium',
      opts.kind,
      opts.text ?? ''
    );
}

describe('firehoseMiningDryRun', () => {
  beforeEach(() => {
    resetTelemetryDbForTests();
    resetFirehoseMiningStateForTests();
  });

  afterEach(() => {
    resetTelemetryDbForTests();
    resetFirehoseMiningStateForTests();
  });

  it('reports zero candidates for an empty firehose', () => {
    const summary = firehoseMiningDryRun();
    expect(summary.candidates).toBe(0);
    expect(summary.totalBytesEstimate).toBe(0);
    expect(summary.bySignal).toEqual({});
  });

  it('counts a single high-signal candidate', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'TypeError: boom' });
    insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'still broken' });

    const summary = firehoseMiningDryRun();
    expect(summary.candidates).toBe(1);
    expect(summary.bySignal.errors).toBe(1);
  });

  it('tallies signals across candidates (a session counts under each of its signals)', () => {
    // t1: errors + long (by count, minEvents lowered to 3)
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'a failed attempt' });
    insertRunEvent({ terminalId: 't1', tsMs: 1100, kind: 'message', text: 'retry' });
    insertRunEvent({ terminalId: 't1', tsMs: 1200, kind: 'message', text: 'retry again' });
    // t2: commits only
    insertRunEvent({ terminalId: 't2', tsMs: 1000, kind: 'command', text: 'git commit -m wip' });
    insertRunEvent({ terminalId: 't2', tsMs: 1100, kind: 'message', text: 'done' });

    const summary = firehoseMiningDryRun({ minEvents: 3, minSpanMs: 60 * MIN });
    expect(summary.candidates).toBe(2);
    expect(summary.bySignal.errors).toBe(1);
    expect(summary.bySignal.long).toBe(1);
    expect(summary.bySignal.commits).toBe(1);
  });

  it('totalBytesEstimate equals the summed reconstructed byte sizes', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'an error happened' });
    insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'context line' });

    const candidates = selectHighSignalSessions();
    const expectedBytes = candidates.reduce(
      (acc, c) => acc + reconstructSession(c.window).bytes,
      0
    );

    const summary = firehoseMiningDryRun();
    expect(summary.totalBytesEstimate).toBe(expectedBytes);
    expect(summary.totalBytesEstimate).toBeGreaterThan(0);
  });

  it('excludes already-mined sessions from the dry-run scope', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'an error occurred' });
    insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'still broken' });

    const before = firehoseMiningDryRun();
    expect(before.candidates).toBe(1);

    const [c] = selectHighSignalSessions();
    markSessionMined({
      terminalId: c.window.terminalId,
      windowStartMs: c.window.windowStartMs,
      windowEndMs: c.window.windowEndMs
    });

    const after = firehoseMiningDryRun();
    expect(after.candidates).toBe(0);
    expect(after.totalBytesEstimate).toBe(0);
  });

  it('honours a maxBytes cap when estimating transcript size', () => {
    for (let i = 0; i < 30; i++) {
      insertRunEvent({
        terminalId: 't1',
        tsMs: 1000 + i,
        kind: 'message',
        text: 'error '.repeat(50) + `_row${i}`
      });
    }

    const capped = firehoseMiningDryRun({ maxBytes: 500 });
    expect(capped.candidates).toBe(1);
    // each candidate transcript capped at 500 bytes → total <= candidates * 500
    expect(capped.totalBytesEstimate).toBeLessThanOrEqual(500);
  });

  it('writes nothing to the firehose (pure read)', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'an error here' });
    insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'raw', text: 'raw noise' });

    firehoseMiningDryRun();

    const runCount = getTelemetryDb()
      .prepare(`SELECT COUNT(*) AS n FROM terminal_run_events`)
      .get() as { n: number };
    expect(runCount.n).toBe(2);
    // and it must NOT have advanced the watermark
    const minedCount = getTelemetryDb()
      .prepare(`SELECT COUNT(*) AS n FROM firehose_mined_sessions`)
      .get() as { n: number };
    expect(minedCount.n).toBe(0);
  });

  it('honours a custom gapMs by splitting windows before counting', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 0, kind: 'message', text: 'first error' });
    insertRunEvent({ terminalId: 't1', tsMs: 10 * MIN, kind: 'message', text: 'second exception' });

    const summary = firehoseMiningDryRun({ gapMs: 5 * MIN });
    expect(summary.candidates).toBe(2);
    expect(summary.bySignal.errors).toBe(2);
  });
});
