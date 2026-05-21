import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapPiContentItem, parsePiTranscriptLine, ingestPiTranscriptLine,
  readCwdFromPiSessionLine, readContextFillFromPiUsageLine
} from './piTranscriptTail';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';
import { getTerminalById, upsertTerminal } from './terminalsStore';

describe('mapPiContentItem', () => {
  it('user text → command', () => {
    expect(mapPiContentItem('user', { type: 'text', text: 'hello pi' }))
      .toEqual({ kind: 'command', text: 'hello pi', trust: 'high' });
  });
  it('assistant text → message', () => {
    expect(mapPiContentItem('assistant', { type: 'text', text: 'reply' }))
      .toEqual({ kind: 'message', text: 'reply', trust: 'high' });
  });
  it('thinking → thinking (assistant only enforced upstream)', () => {
    expect(mapPiContentItem('assistant', { type: 'thinking', thinking: 'reasoning' }))
      .toEqual({ kind: 'thinking', text: 'reasoning', trust: 'high' });
  });
  it('toolCall → tool_call name + arguments', () => {
    const r = mapPiContentItem('assistant', {
      type: 'toolCall', name: 'bash', arguments: { command: 'ls' }
    });
    expect(r?.kind).toBe('tool_call');
    expect(r?.text).toContain('bash');
    expect(r?.text).toContain('ls');
  });
  it('toolResult → message (result body)', () => {
    expect(mapPiContentItem('assistant', { type: 'toolResult', result: 'output here' }))
      .toEqual({ kind: 'message', text: 'output here', trust: 'high' });
  });
  it('returns null for empty text', () => {
    expect(mapPiContentItem('user', { type: 'text', text: '' })).toBeNull();
  });
});

describe('parsePiTranscriptLine', () => {
  it('parses message with multiple content items', () => {
    const line = JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'text', text: 'doing it' },
          { type: 'toolCall', name: 'bash', arguments: { command: 'ls' } }
        ]
      }
    });
    const events = parsePiTranscriptLine(line);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(['thinking', 'message', 'tool_call']);
  });
  it('skips type=session/model_change/thinking_level_change', () => {
    expect(parsePiTranscriptLine(JSON.stringify({
      type: 'session', cwd: '/foo', id: 'x'
    }))).toEqual([]);
    expect(parsePiTranscriptLine(JSON.stringify({
      type: 'model_change', provider: 'lmstudio'
    }))).toEqual([]);
    expect(parsePiTranscriptLine(JSON.stringify({
      type: 'thinking_level_change', thinkingLevel: 'off'
    }))).toEqual([]);
  });
  it('returns [] for malformed JSON', () => {
    expect(parsePiTranscriptLine('garbage')).toEqual([]);
  });
});

describe('readCwdFromPiSessionLine', () => {
  it('extracts cwd from type=session', () => {
    const line = JSON.stringify({
      type: 'session', id: 'x', cwd: '/Users/test', timestamp: '2026-05-15'
    });
    expect(readCwdFromPiSessionLine(line)).toBe('/Users/test');
  });
  it('returns null for non-session lines', () => {
    expect(readCwdFromPiSessionLine(JSON.stringify({ type: 'message' }))).toBeNull();
  });
  it('returns null for malformed', () => {
    expect(readCwdFromPiSessionLine('garbage')).toBeNull();
  });
});

describe('readContextFillFromPiUsageLine', () => {
  it('extracts Pi context fill from assistant usage counters', () => {
    const line = JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        usage: { input: 32_000, cacheRead: 16_000, cacheWrite: 16_000 }
      }
    });

    expect(readContextFillFromPiUsageLine(line)).toEqual({
      fill: 0.5,
      inputTokens: 64_000,
      contextWindow: 128_000
    });
  });

  it('ignores Pi lines without usage', () => {
    expect(readContextFillFromPiUsageLine('garbage')).toBeNull();
    expect(readContextFillFromPiUsageLine(JSON.stringify({
      type: 'message',
      message: { role: 'assistant', content: [] }
    }))).toBeNull();
  });
});

describe('ingestPiTranscriptLine — DB roundtrip', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('persists assistant text as kind=message trust=high source=transcript', () => {
    const SID = 't_pi_1';
    const line = JSON.stringify({
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'pi reply' }] }
    });
    expect(ingestPiTranscriptLine(SID, line)).toBe(1);
    const events = listLatestTerminalRunEvents(SID, 5);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('message');
    expect(events[0].text).toBe('pi reply');
    expect(events[0].source).toBe('transcript');
  });

  it('no-op for session line', () => {
    const SID = 't_pi_2';
    expect(ingestPiTranscriptLine(SID, JSON.stringify({
      type: 'session', cwd: '/x', id: 'y'
    }))).toBe(0);
    expect(listLatestTerminalRunEvents(SID, 5)).toHaveLength(0);
  });

  it('persists context-fill from Pi usage lines alongside run events', () => {
    const terminal = upsertTerminal({ pid: 422, pid_start: 'pst', name: 'pi-context-fill-test' });
    const line = JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'pi reply' }],
        usage: { input: 32_000, cacheRead: 16_000, cacheWrite: 16_000 }
      }
    });

    expect(ingestPiTranscriptLine(terminal.id, line)).toBe(1);
    const row = getTerminalById(terminal.id);
    expect(row?.agent_context_fill).toBeCloseTo(0.5);
    expect(row?.agent_context_fill_source).toBe('pi-transcript-usage');
    expect(typeof row?.agent_context_fill_at_ms).toBe('number');
  });
});
