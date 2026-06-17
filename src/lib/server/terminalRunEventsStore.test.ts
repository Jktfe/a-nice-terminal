/**
 * CLEANUP slice (V4-BLOCKER-A) regression: non-raw kinds are control-byte
 * sanitized at the persistence boundary; kind=raw is untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  appendTerminalRunEvent,
  listLatestTerminalRunEvents,
  listTerminalRunEventsSince,
  softDeleteTerminalRunEvents,
  readAllTerminalRunEventsForArchive
} from './terminalRunEventsStore';
import { getIdentityDb } from './db';
import { getTelemetryDb, resetTelemetryDbForTests } from './telemetryDb';

describe('softDeleteTerminalRunEvents (archived-terminal delete)', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
    try { getTelemetryDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('hides the terminal events from readers + counts them, leaving others', () => {
    appendTerminalRunEvent({ terminalId: 't_del', kind: 'message', text: 'a', source: 'transcript' });
    appendTerminalRunEvent({ terminalId: 't_del', kind: 'message', text: 'b', source: 'transcript' });
    appendTerminalRunEvent({ terminalId: 't_keep', kind: 'message', text: 'c', source: 'transcript' });

    // Archive read sees both before delete; other terminal untouched.
    expect(readAllTerminalRunEventsForArchive('t_del').map((e) => e.text)).toEqual(['a', 'b']);

    const hidden = softDeleteTerminalRunEvents('t_del', 1000);
    expect(hidden).toBe(2);
    expect(listLatestTerminalRunEvents('t_del', 10)).toHaveLength(0);
    expect(readAllTerminalRunEventsForArchive('t_del')).toHaveLength(0);
    expect(listLatestTerminalRunEvents('t_keep', 10)).toHaveLength(1);
  });
});

describe('appendTerminalRunEvent — control-byte sanitize (V4-BLOCKER-A)', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('strips ANSI/control bytes from kind=message before INSERT', () => {
    appendTerminalRunEvent({
      terminalId: 't_san_1', kind: 'message',
      text: 'hello\x1b[Kworld\r', trust: 'high', source: 'transcript'
    });
    const e = listLatestTerminalRunEvents('t_san_1', 5)[0];
    expect(e.text).toBe('helloworld');
  });

  it('strips ANSI from kind=thinking + kind=tool_call + kind=command', () => {
    for (const kind of ['thinking', 'tool_call', 'command']) {
      appendTerminalRunEvent({
        terminalId: `t_san_${kind}`, kind,
        text: `\x1b[31mred\x1b[0m text`, trust: 'high'
      });
      const e = listLatestTerminalRunEvents(`t_san_${kind}`, 5)[0];
      expect(e.text).toBe('red text');
    }
  });

  it('leaves kind=raw untouched (xterm needs literal escapes)', () => {
    const raw = 'esc\x1b[Kseq\r\nkeep';
    appendTerminalRunEvent({
      terminalId: 't_san_raw', kind: 'raw', text: raw, trust: 'raw'
    });
    const e = listLatestTerminalRunEvents('t_san_raw', 5)[0];
    expect(e.text).toBe(raw);
  });

  it('preserves newlines and tabs in non-raw text', () => {
    appendTerminalRunEvent({
      terminalId: 't_san_nl', kind: 'message',
      text: 'line1\nline2\tcol', trust: 'high'
    });
    const e = listLatestTerminalRunEvents('t_san_nl', 5)[0];
    expect(e.text).toBe('line1\nline2\tcol');
  });

  it('plain text passes through unchanged', () => {
    appendTerminalRunEvent({
      terminalId: 't_san_plain', kind: 'message',
      text: 'a perfectly clean reply', trust: 'high'
    });
    const e = listLatestTerminalRunEvents('t_san_plain', 5)[0];
    expect(e.text).toBe('a perfectly clean reply');
  });
});

describe('TRANSCRIPT-AUTHORITATIVE-GATE (P0 2026-05-15)', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('suppresses pty non-raw when transcript rows exist for the terminal', () => {
    const T = 't_gate_1';
    // pty TUI-chrome scrape (the garbage)
    appendTerminalRunEvent({ terminalId: T, kind: 'message', text: 'qqqqq TUI', trust: 'medium', source: 'pty' });
    appendTerminalRunEvent({ terminalId: T, kind: 'raw', text: '\x1b[K raw', trust: 'raw', source: 'pty' });
    // clean transcript row
    appendTerminalRunEvent({ terminalId: T, kind: 'message', text: 'real reply', trust: 'high', source: 'transcript', transcriptEventId: 'u#0' });
    const ev = listLatestTerminalRunEvents(T, 50);
    const msgs = ev.filter((e) => e.kind === 'message');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('real reply');
    expect(msgs[0].source).toBe('transcript');
    // raw pty still present (RAW view passthrough)
    expect(ev.some((e) => e.kind === 'raw' && e.source === 'pty')).toBe(true);
  });

  it('serves full feed (incl pty non-raw) when NO transcript rows (bare shell)', () => {
    const T = 't_gate_2';
    appendTerminalRunEvent({ terminalId: T, kind: 'message', text: 'shell echo', trust: 'medium', source: 'pty' });
    appendTerminalRunEvent({ terminalId: T, kind: 'raw', text: 'raw', trust: 'raw', source: 'pty' });
    const ev = listLatestTerminalRunEvents(T, 50);
    expect(ev.filter((e) => e.kind === 'message')).toHaveLength(1);
  });

  it('gate also applies to listTerminalRunEventsSince', () => {
    const T = 't_gate_3';
    appendTerminalRunEvent({ terminalId: T, kind: 'thinking', text: 'pty noise', trust: 'medium', source: 'pty' });
    appendTerminalRunEvent({ terminalId: T, kind: 'message', text: 'clean', trust: 'high', source: 'transcript', transcriptEventId: 'u#1' });
    const ev = listTerminalRunEventsSince(T, 0, 50);
    expect(ev.some((e) => e.source === 'pty' && e.kind !== 'raw')).toBe(false);
    expect(ev.some((e) => e.source === 'transcript')).toBe(true);
  });

  it('supports explicit source filters for ANT v4 transcript-only rendering', () => {
    const T = 't_gate_4';
    appendTerminalRunEvent({ terminalId: T, kind: 'raw', text: 'raw tui bytes', trust: 'raw', source: 'pty', tsMs: 1 });
    appendTerminalRunEvent({ terminalId: T, kind: 'message', text: 'clean transcript', trust: 'high', source: 'transcript', transcriptEventId: 'u#2', tsMs: 2 });
    appendTerminalRunEvent({ terminalId: T, kind: 'agent_prompt', text: 'confirm?', trust: 'high', source: 'interactive', tsMs: 3 });
    const ev = listLatestTerminalRunEvents(T, 50, undefined, ['transcript', 'interactive']);
    expect(ev.map((e) => e.source)).toEqual(['transcript', 'interactive']);
    expect(ev.some((e) => e.source === 'pty')).toBe(false);
  });
});

describe('appendTerminalRunEvent — transcript idempotency (V4-BLOCKER-B)', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('same transcriptEventId inserted twice = ONE row (restart-safe)', () => {
    const key = 'uuid-abc#0';
    appendTerminalRunEvent({
      terminalId: 't_idem_1', kind: 'message', text: 'reply',
      trust: 'high', source: 'transcript', transcriptEventId: key
    });
    appendTerminalRunEvent({
      terminalId: 't_idem_1', kind: 'message', text: 'reply',
      trust: 'high', source: 'transcript', transcriptEventId: key
    });
    expect(listLatestTerminalRunEvents('t_idem_1', 10)).toHaveLength(1);
  });

  it('different transcriptEventId = distinct rows', () => {
    appendTerminalRunEvent({
      terminalId: 't_idem_2', kind: 'message', text: 'a',
      trust: 'high', transcriptEventId: 'x#0'
    });
    appendTerminalRunEvent({
      terminalId: 't_idem_2', kind: 'message', text: 'b',
      trust: 'high', transcriptEventId: 'x#1'
    });
    expect(listLatestTerminalRunEvents('t_idem_2', 10)).toHaveLength(2);
  });

  it('null transcriptEventId rows are NOT deduped (pty/classifier path)', () => {
    appendTerminalRunEvent({ terminalId: 't_idem_3', kind: 'raw', text: 'x', trust: 'raw' });
    appendTerminalRunEvent({ terminalId: 't_idem_3', kind: 'raw', text: 'x', trust: 'raw' });
    expect(listLatestTerminalRunEvents('t_idem_3', 10)).toHaveLength(2);
  });

  it('same id across DIFFERENT terminals = distinct (terminal-scoped)', () => {
    appendTerminalRunEvent({
      terminalId: 't_idem_A', kind: 'message', text: 'a',
      trust: 'high', transcriptEventId: 'shared#0'
    });
    appendTerminalRunEvent({
      terminalId: 't_idem_B', kind: 'message', text: 'b',
      trust: 'high', transcriptEventId: 'shared#0'
    });
    expect(listLatestTerminalRunEvents('t_idem_A', 5)).toHaveLength(1);
    expect(listLatestTerminalRunEvents('t_idem_B', 5)).toHaveLength(1);
  });
});

describe('telemetry sidecar dual-read (flag on)', () => {
  const PREV_FLAG = process.env.ANT_TELEMETRY_SIDECAR;

  beforeEach(() => {
    resetTelemetryDbForTests();
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch { /* ignore */ }
    process.env.ANT_TELEMETRY_SIDECAR = 'on';
  });

  afterEach(() => {
    resetTelemetryDbForTests();
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch { /* ignore */ }
    if (PREV_FLAG === undefined) delete process.env.ANT_TELEMETRY_SIDECAR;
    else process.env.ANT_TELEMETRY_SIDECAR = PREV_FLAG;
  });

  it('writes land in the telemetry DB, not the identity DB', () => {
    appendTerminalRunEvent({ terminalId: 't_side', kind: 'message', text: 'new', trust: 'high' });
    const inIdentity = getIdentityDb()
      .prepare(`SELECT COUNT(*) AS n FROM terminal_run_events WHERE terminal_id = ?`)
      .get('t_side') as { n: number };
    const inTelemetry = getTelemetryDb()
      .prepare(`SELECT COUNT(*) AS n FROM terminal_run_events WHERE terminal_id = ?`)
      .get('t_side') as { n: number };
    expect(inIdentity.n).toBe(0);
    expect(inTelemetry.n).toBe(1);
  });

  it('reads union old (identity) + new (telemetry) rows in ts order', () => {
    // Simulate a pre-cutover row still in the identity DB.
    getIdentityDb()
      .prepare(
        `INSERT INTO terminal_run_events (terminal_id, ts_ms, source, trust, kind, text, payload)
         VALUES (?, ?, 'transcript', 'high', 'message', ?, '{}')`
      )
      .run('t_dual', 1000, 'old-row');
    // A post-cutover row written through the store → telemetry DB. source =
    // 'transcript' so the authoritative-transcript gate (triggered by the old
    // transcript row) doesn't suppress it — we're isolating the dual-read here.
    appendTerminalRunEvent({ terminalId: 't_dual', kind: 'message', text: 'new-row', trust: 'high', source: 'transcript', tsMs: 2000 });

    const latest = listLatestTerminalRunEvents('t_dual', 10);
    expect(latest.map((e) => e.text)).toEqual(['old-row', 'new-row']); // ascending by ts
    const since = listTerminalRunEventsSince('t_dual', 1500, 10);
    expect(since.map((e) => e.text)).toEqual(['new-row']); // only the new row is > since
  });
});
