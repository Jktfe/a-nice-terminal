/**
 * sessionReconstruct tests — firehose MINING PASS (2026-06-10).
 *
 * Covers windowing (idle-gap split) + transcript reconstruction (ts_ms order,
 * raw-noise dropped, cli_hook_events interleaved, byte cap enforced). Fixture
 * rows are inserted directly into the telemetry sidecar via getTelemetryDb so
 * the tests exercise the same store the mining pass reads. Per-worker isolation
 * comes from resetTelemetryDbForTests (telemetry sidecar pattern).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTelemetryDb, resetTelemetryDbForTests } from './telemetryDb';
import { listSessionWindows, reconstructSession } from './sessionReconstruct';

const MIN = 60 * 1000;

function insertRunEvent(opts: {
  terminalId: string;
  tsMs: number;
  kind: string;
  text?: string;
  source?: string;
}): void {
  getTelemetryDb()
    .prepare(
      `INSERT INTO terminal_run_events (terminal_id, ts_ms, source, trust, kind, text)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.terminalId,
      opts.tsMs,
      opts.source ?? 'pty',
      opts.kind === 'raw' ? 'raw' : 'medium',
      opts.kind,
      opts.text ?? ''
    );
}

function insertHookEvent(opts: {
  sessionId: string;
  hookEventName: string;
  receivedAtMs: number;
  toolName?: string;
  payload?: Record<string, unknown>;
}): void {
  getTelemetryDb()
    .prepare(
      `INSERT INTO cli_hook_events
         (source_cli, session_id, hook_event_name, received_at_ms, tool_name, payload)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      'claude-code',
      opts.sessionId,
      opts.hookEventName,
      opts.receivedAtMs,
      opts.toolName ?? null,
      JSON.stringify(opts.payload ?? {})
    );
}

describe('sessionReconstruct', () => {
  beforeEach(() => {
    resetTelemetryDbForTests();
  });

  afterEach(() => {
    resetTelemetryDbForTests();
  });

  describe('listSessionWindows', () => {
    it('returns no windows for an empty firehose', () => {
      expect(listSessionWindows()).toEqual([]);
    });

    it('groups a single contiguous stretch into one window with the right bounds + count', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'a' });
      insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'b' });
      insertRunEvent({ terminalId: 't1', tsMs: 3000, kind: 'tool_call', text: 'c' });

      const windows = listSessionWindows();
      expect(windows).toHaveLength(1);
      expect(windows[0]).toMatchObject({
        terminalId: 't1',
        windowStartMs: 1000,
        windowEndMs: 3000,
        eventCount: 3
      });
    });

    it('splits a terminal into two windows on an idle gap > gapMs', () => {
      // First stretch
      insertRunEvent({ terminalId: 't1', tsMs: 0, kind: 'message', text: 'a' });
      insertRunEvent({ terminalId: 't1', tsMs: 5 * MIN, kind: 'message', text: 'b' });
      // Idle gap of 40 min (> default 30 min) then a second stretch
      insertRunEvent({ terminalId: 't1', tsMs: 45 * MIN, kind: 'message', text: 'c' });
      insertRunEvent({ terminalId: 't1', tsMs: 50 * MIN, kind: 'message', text: 'd' });

      const windows = listSessionWindows();
      expect(windows).toHaveLength(2);
      expect(windows[0]).toMatchObject({ windowStartMs: 0, windowEndMs: 5 * MIN, eventCount: 2 });
      expect(windows[1]).toMatchObject({ windowStartMs: 45 * MIN, windowEndMs: 50 * MIN, eventCount: 2 });
    });

    it('does NOT split when the gap is within gapMs', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 0, kind: 'message', text: 'a' });
      insertRunEvent({ terminalId: 't1', tsMs: 20 * MIN, kind: 'message', text: 'b' });
      const windows = listSessionWindows();
      expect(windows).toHaveLength(1);
      expect(windows[0].eventCount).toBe(2);
    });

    it('honours a custom gapMs', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 0, kind: 'message', text: 'a' });
      insertRunEvent({ terminalId: 't1', tsMs: 10 * MIN, kind: 'message', text: 'b' });
      // gap of 10 min — split when gapMs is smaller (5 min)
      const windows = listSessionWindows({ gapMs: 5 * MIN });
      expect(windows).toHaveLength(2);
    });

    it('separates distinct terminals into distinct windows', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'a' });
      insertRunEvent({ terminalId: 't2', tsMs: 1500, kind: 'message', text: 'b' });
      const windows = listSessionWindows();
      expect(windows).toHaveLength(2);
      const ids = windows.map((w) => w.terminalId).sort();
      expect(ids).toEqual(['t1', 't2']);
    });
  });

  describe('reconstructSession', () => {
    it('orders rows by ts_ms and drops kind=raw noise', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 3000, kind: 'message', text: 'third' });
      insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'first' });
      insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'raw', text: 'RAWNOISE' });
      insertRunEvent({ terminalId: 't1', tsMs: 2500, kind: 'tool_call', text: 'second' });

      const [window] = listSessionWindows();
      const result = reconstructSession(window);

      // ordered first < second < third
      const idxFirst = result.transcript.indexOf('first');
      const idxSecond = result.transcript.indexOf('second');
      const idxThird = result.transcript.indexOf('third');
      expect(idxFirst).toBeGreaterThanOrEqual(0);
      expect(idxFirst).toBeLessThan(idxSecond);
      expect(idxSecond).toBeLessThan(idxThird);
      // raw noise dropped
      expect(result.transcript).not.toContain('RAWNOISE');
      // kind tag prefix present
      expect(result.transcript).toContain('message');
      expect(result.transcript).toContain('tool_call');
    });

    it('interleaves a cli_hook_events row by received_at_ms within the window range', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'before-hook' });
      insertRunEvent({ terminalId: 't1', tsMs: 3000, kind: 'message', text: 'after-hook' });
      insertHookEvent({
        sessionId: 's1',
        hookEventName: 'PreToolUse',
        receivedAtMs: 2000,
        toolName: 'Bash',
        payload: { tool_input: { command: 'git status' } }
      });

      const [window] = listSessionWindows();
      const result = reconstructSession(window);

      expect(result.transcript).toContain('before-hook');
      expect(result.transcript).toContain('after-hook');
      // hook event interleaved between the two run events
      const idxBefore = result.transcript.indexOf('before-hook');
      const idxHook = result.transcript.indexOf('PreToolUse');
      const idxAfter = result.transcript.indexOf('after-hook');
      expect(idxHook).toBeGreaterThan(idxBefore);
      expect(idxHook).toBeLessThan(idxAfter);
      expect(result.transcript).toContain('Bash');
    });

    it('excludes cli_hook_events outside the window time range', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'in-window' });
      insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'also-in' });
      // hook event well before the window
      insertHookEvent({ sessionId: 's1', hookEventName: 'OutOfRange', receivedAtMs: 1 });

      const [window] = listSessionWindows();
      const result = reconstructSession(window);
      expect(result.transcript).not.toContain('OutOfRange');
    });

    it('enforces the maxBytes cap with a truncation marker', () => {
      // 50 rows of ~300 bytes each = ~15k bytes; cap at 1000 bytes
      for (let i = 0; i < 50; i++) {
        insertRunEvent({
          terminalId: 't1',
          tsMs: 1000 + i,
          kind: 'message',
          text: 'x'.repeat(300) + `_row${i}`
        });
      }
      const [window] = listSessionWindows();
      const result = reconstructSession(window, { maxBytes: 1000 });

      expect(result.bytes).toBeLessThanOrEqual(1000);
      expect(Buffer.byteLength(result.transcript, 'utf8')).toBeLessThanOrEqual(1000);
      expect(result.transcript).toMatch(/truncat/i);
    });

    it('reports bytes equal to the utf8 byte length of the transcript', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'hello' });
      const [window] = listSessionWindows();
      const result = reconstructSession(window);
      expect(result.bytes).toBe(Buffer.byteLength(result.transcript, 'utf8'));
    });

    it('is a pure read — does not mutate the firehose', () => {
      insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'a' });
      insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'raw', text: 'b' });
      const [window] = listSessionWindows();
      reconstructSession(window);
      const count = getTelemetryDb()
        .prepare(`SELECT COUNT(*) AS n FROM terminal_run_events`)
        .get() as { n: number };
      expect(count.n).toBe(2);
    });
  });
});
