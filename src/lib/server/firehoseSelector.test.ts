/**
 * firehoseSelector tests — firehose MINING PASS (2026-06-10).
 *
 * Covers the high-signal selector: it lists session windows (via
 * sessionReconstruct.listSessionWindows), EXCLUDES already-mined windows (via
 * firehoseMiningState.isSessionMined), and flags each remaining window on any
 * of the errors / commits / long signals. Only windows with >=1 signal are
 * returned, each carrying its qualifying signals.
 *
 * Fixture rows go directly into the telemetry sidecar via getTelemetryDb so the
 * tests exercise the same store the mining pass reads. Per-worker isolation
 * comes from resetTelemetryDbForTests (telemetry sidecar pattern).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTelemetryDb, resetTelemetryDbForTests } from './telemetryDb';
import { markSessionMined, resetFirehoseMiningStateForTests } from './firehoseMiningState';
import { selectHighSignalSessions, type Candidate } from './firehoseSelector';

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

function findCandidate(candidates: Candidate[], terminalId: string): Candidate | undefined {
  return candidates.find((c) => c.window.terminalId === terminalId);
}

describe('firehoseSelector', () => {
  beforeEach(() => {
    resetTelemetryDbForTests();
    resetFirehoseMiningStateForTests();
  });

  afterEach(() => {
    resetTelemetryDbForTests();
    resetFirehoseMiningStateForTests();
  });

  it('returns no candidates for an empty firehose', () => {
    expect(selectHighSignalSessions()).toEqual([]);
  });

  it('selects an errors-only session with signals=[errors]', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'hello there' });
    insertRunEvent({
      terminalId: 't1',
      tsMs: 2000,
      kind: 'message',
      text: 'TypeError: undefined is not a function'
    });

    const candidates = selectHighSignalSessions();
    const c = findCandidate(candidates, 't1');
    expect(c).toBeDefined();
    expect(c!.signals).toEqual(['errors']);
  });

  it('matches the full error pattern set case-insensitively', () => {
    const words = ['Exception', 'FAILED', 'Traceback', 'Fatal', 'panic'];
    words.forEach((word, i) => {
      insertRunEvent({ terminalId: `t${i}`, tsMs: 1000, kind: 'message', text: `a ${word} happened` });
    });
    const candidates = selectHighSignalSessions();
    words.forEach((_, i) => {
      const c = findCandidate(candidates, `t${i}`);
      expect(c).toBeDefined();
      expect(c!.signals).toContain('errors');
    });
  });

  it('does NOT match the error pattern on a raw-noise row', () => {
    // a raw row containing 'error' must not flag — only classified rows count
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'raw', text: 'error in raw bytes' });
    insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'all good' });
    const candidates = selectHighSignalSessions();
    expect(findCandidate(candidates, 't1')).toBeUndefined();
  });

  it('does NOT select a clean short session', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'just chatting' });
    insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'all fine here' });
    const candidates = selectHighSignalSessions();
    expect(findCandidate(candidates, 't1')).toBeUndefined();
  });

  it('selects a commit session via text matching git commit', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'command', text: 'git commit -m "feat: ship it"' });
    insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'done' });
    const candidates = selectHighSignalSessions();
    const c = findCandidate(candidates, 't1');
    expect(c).toBeDefined();
    expect(c!.signals).toContain('commits');
  });

  it('selects a commit session via a cli_hook Bash tool-call running git merge', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'merging' });
    insertRunEvent({ terminalId: 't1', tsMs: 3000, kind: 'message', text: 'merged' });
    insertHookEvent({
      sessionId: 's1',
      hookEventName: 'PreToolUse',
      receivedAtMs: 2000,
      toolName: 'Bash',
      payload: { tool_input: { command: 'git merge --no-ff feature' } }
    });
    const candidates = selectHighSignalSessions();
    const c = findCandidate(candidates, 't1');
    expect(c).toBeDefined();
    expect(c!.signals).toContain('commits');
  });

  it('selects a long session by event count >= minEvents with signal=long', () => {
    // 5 events, lower minEvents to 5 so the fixture stays small
    for (let i = 0; i < 5; i++) {
      insertRunEvent({ terminalId: 't1', tsMs: 1000 + i * 100, kind: 'message', text: `step ${i}` });
    }
    const candidates = selectHighSignalSessions({ minEvents: 5, minSpanMs: 60 * MIN });
    const c = findCandidate(candidates, 't1');
    expect(c).toBeDefined();
    expect(c!.signals).toContain('long');
  });

  it('selects a long session by span >= minSpanMs with signal=long', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 0, kind: 'message', text: 'start' });
    insertRunEvent({ terminalId: 't1', tsMs: 25 * MIN, kind: 'message', text: 'end' });
    // default minSpanMs is 20 min; raise minEvents so only the span signal fires
    const candidates = selectHighSignalSessions({ minEvents: 1000 });
    const c = findCandidate(candidates, 't1');
    expect(c).toBeDefined();
    expect(c!.signals).toContain('long');
  });

  it('does NOT select a short session below both long thresholds', () => {
    for (let i = 0; i < 3; i++) {
      insertRunEvent({ terminalId: 't1', tsMs: 1000 + i * 100, kind: 'message', text: `step ${i}` });
    }
    const candidates = selectHighSignalSessions({ minEvents: 150, minSpanMs: 20 * MIN });
    expect(findCandidate(candidates, 't1')).toBeUndefined();
  });

  it('reports multiple signals for a session qualifying on several', () => {
    // errors + long (by count, minEvents lowered to 3)
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'a failed attempt' });
    insertRunEvent({ terminalId: 't1', tsMs: 1100, kind: 'message', text: 'retry' });
    insertRunEvent({ terminalId: 't1', tsMs: 1200, kind: 'message', text: 'retry again' });
    const candidates = selectHighSignalSessions({ minEvents: 3, minSpanMs: 60 * MIN });
    const c = findCandidate(candidates, 't1');
    expect(c).toBeDefined();
    expect(c!.signals).toContain('errors');
    expect(c!.signals).toContain('long');
  });

  it('excludes an already-mined session', () => {
    insertRunEvent({ terminalId: 't1', tsMs: 1000, kind: 'message', text: 'an error occurred' });
    insertRunEvent({ terminalId: 't1', tsMs: 2000, kind: 'message', text: 'still broken' });

    // first pass: t1 is selected
    const before = selectHighSignalSessions();
    const c = findCandidate(before, 't1');
    expect(c).toBeDefined();

    // mark it mined with its exact window key, then re-select → excluded
    markSessionMined({
      terminalId: c!.window.terminalId,
      windowStartMs: c!.window.windowStartMs,
      windowEndMs: c!.window.windowEndMs
    });

    const after = selectHighSignalSessions();
    expect(findCandidate(after, 't1')).toBeUndefined();
  });

  it('honours a custom gapMs by splitting windows before selection', () => {
    // two stretches 10 min apart, each an errors session
    insertRunEvent({ terminalId: 't1', tsMs: 0, kind: 'message', text: 'first error' });
    insertRunEvent({ terminalId: 't1', tsMs: 10 * MIN, kind: 'message', text: 'second exception' });
    // with a 5-min gap they split into two windows; both have an error signal
    const candidates = selectHighSignalSessions({ gapMs: 5 * MIN });
    const t1 = candidates.filter((c) => c.window.terminalId === 't1');
    expect(t1).toHaveLength(2);
    t1.forEach((c) => expect(c.signals).toContain('errors'));
  });
});
