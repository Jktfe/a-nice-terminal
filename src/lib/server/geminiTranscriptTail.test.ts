import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapGeminiEvent, parseGeminiTranscriptLine, ingestGeminiTranscriptLine,
  geminiProjectDirNameForCwd
} from './geminiTranscriptTail';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';

describe('geminiProjectDirNameForCwd', () => {
  it('lowercases basename', () => {
    expect(geminiProjectDirNameForCwd('/Users/jamesking/CascadeProjects'))
      .toBe('cascadeprojects');
    expect(geminiProjectDirNameForCwd('/foo/A-Nice-Terminal'))
      .toBe('a-nice-terminal');
  });
});

describe('mapGeminiEvent', () => {
  it('user content array → command', () => {
    expect(mapGeminiEvent({ type: 'user', content: [{ text: 'hi gemini' }] }))
      .toEqual([{ kind: 'command', text: 'hi gemini', trust: 'high' }]);
  });

  it('user content string → command', () => {
    expect(mapGeminiEvent({ type: 'user', content: 'hi' }))
      .toEqual([{ kind: 'command', text: 'hi', trust: 'high' }]);
  });

  it('gemini with thoughts + content → thinking + message', () => {
    const r = mapGeminiEvent({
      type: 'gemini',
      content: 'final answer',
      thoughts: [
        { subject: 'Step 1', description: 'Plan it' },
        { subject: 'Step 2', description: 'Do it' }
      ]
    });
    expect(r).toHaveLength(2);
    expect(r[0].kind).toBe('thinking');
    expect(r[0].text).toContain('Step 1: Plan it');
    expect(r[0].text).toContain('Step 2: Do it');
    expect(r[1].kind).toBe('message');
    expect(r[1].text).toBe('final answer');
  });

  it('gemini with empty content but thoughts → only thinking', () => {
    const r = mapGeminiEvent({
      type: 'gemini', content: '',
      thoughts: [{ subject: 'X', description: 'Y' }]
    });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('thinking');
  });

  it('skips info / $set metadata / no-type lines (session_meta)', () => {
    expect(mapGeminiEvent({ type: 'info', content: 'CLI update available' })).toEqual([]);
    expect(mapGeminiEvent({ $set: { lastUpdated: '...' } })).toEqual([]);
    expect(mapGeminiEvent({ sessionId: 'abc' } as any)).toEqual([]);
  });
});

describe('parseGeminiTranscriptLine', () => {
  it('parses user line with content array', () => {
    const line = JSON.stringify({
      id: 'x', timestamp: '2026-05-15', type: 'user',
      content: [{ text: 'hello' }]
    });
    expect(parseGeminiTranscriptLine(line)).toEqual([
      { kind: 'command', text: 'hello', trust: 'high' }
    ]);
  });

  it('returns [] for malformed JSON', () => {
    expect(parseGeminiTranscriptLine('garbage')).toEqual([]);
  });
});

describe('ingestGeminiTranscriptLine — DB roundtrip', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('persists gemini reply as kind=message trust=high source=transcript', () => {
    const SID = 't_gem_1';
    const line = JSON.stringify({
      type: 'gemini', content: 'answer body'
    });
    expect(ingestGeminiTranscriptLine(SID, line)).toBe(1);
    const events = listLatestTerminalRunEvents(SID, 5);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('message');
    expect(events[0].source).toBe('transcript');
  });

  it('no-op for $set / info / session_meta', () => {
    const SID = 't_gem_2';
    expect(ingestGeminiTranscriptLine(SID, JSON.stringify({ $set: { lastUpdated: 'x' } }))).toBe(0);
    expect(ingestGeminiTranscriptLine(SID, JSON.stringify({ type: 'info', content: 'x' }))).toBe(0);
    expect(ingestGeminiTranscriptLine(SID, JSON.stringify({ sessionId: 'x' }))).toBe(0);
    expect(listLatestTerminalRunEvents(SID, 5)).toHaveLength(0);
  });
});
