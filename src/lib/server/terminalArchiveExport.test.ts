import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb } from './db';
import { getTelemetryDb } from './telemetryDb';
import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { archiveTerminalRunEvents } from './terminalArchiveExport';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ant-archive-'));
  try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  try { getTelemetryDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('archiveTerminalRunEvents (mine half of delete)', () => {
  it('writes the retained events to a durable file and reports where + how many', () => {
    appendTerminalRunEvent({ terminalId: 't_arch', kind: 'message', text: 'first', source: 'transcript' });
    appendTerminalRunEvent({ terminalId: 't_arch', kind: 'message', text: 'second', source: 'transcript' });

    const result = archiveTerminalRunEvents('t_arch', { dir, nowMs: 42 });

    expect(result.eventsArchived).toBe(2);
    expect(result.archivedTo).toBe(join(dir, 't_arch-42.json'));
    const written = JSON.parse(readFileSync(result.archivedTo, 'utf8'));
    expect(written.terminalId).toBe('t_arch');
    expect(written.eventCount).toBe(2);
    expect(written.events.map((e: { text: string }) => e.text)).toEqual(['first', 'second']);
  });

  it('archives an empty file (0 events) without throwing', () => {
    const result = archiveTerminalRunEvents('t_none', { dir, nowMs: 7 });
    expect(result.eventsArchived).toBe(0);
    expect(JSON.parse(readFileSync(result.archivedTo, 'utf8')).events).toEqual([]);
  });
});
