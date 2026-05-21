import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapQwenPart, parseQwenTranscriptLine, ingestQwenTranscriptLine,
  readCwdFromQwenLine, encodedCwdSegmentForQwen, readContextFillFromQwenUsageLine
} from './qwenTranscriptTail';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';
import { getTerminalById, upsertTerminal } from './terminalsStore';

describe('encodedCwdSegmentForQwen', () => {
  it('replaces all slashes with dashes including leading', () => {
    expect(encodedCwdSegmentForQwen('/Users/you/CascadeProjects/a-nice-terminal'))
      .toBe('-Users-you-CascadeProjects-a-nice-terminal');
  });
});

describe('mapQwenPart', () => {
  it('user text → command', () => {
    expect(mapQwenPart('user', { text: 'hi qwen' }))
      .toEqual({ kind: 'command', text: 'hi qwen', trust: 'high' });
  });
  it('assistant text → message', () => {
    expect(mapQwenPart('model', { text: 'reply' }))
      .toEqual({ kind: 'message', text: 'reply', trust: 'high' });
  });
  it('thought:true text → thinking', () => {
    expect(mapQwenPart('model', { text: 'plan', thought: true }))
      .toEqual({ kind: 'thinking', text: 'plan', trust: 'high' });
  });
  it('functionCall → tool_call with name + args', () => {
    const r = mapQwenPart('model', {
      functionCall: { id: 'c1', name: 'read_file', args: { path: '/x' } }
    });
    expect(r?.kind).toBe('tool_call');
    expect(r?.text).toContain('read_file');
    expect(r?.text).toContain('/x');
  });
  it('functionResponse → message', () => {
    expect(mapQwenPart('user', {
      functionResponse: { id: 'c1', name: 'read_file', response: 'file body' }
    })).toEqual({ kind: 'message', text: 'file body', trust: 'high' });
  });
});

describe('parseQwenTranscriptLine', () => {
  it('parses user message with parts', () => {
    const line = JSON.stringify({
      type: 'user', cwd: '/p',
      message: { role: 'user', parts: [{ text: 'hello' }] }
    });
    expect(parseQwenTranscriptLine(line)).toEqual([
      { kind: 'command', text: 'hello', trust: 'high' }
    ]);
  });
  it('parses assistant with mixed parts (thinking + text + functionCall)', () => {
    const line = JSON.stringify({
      type: 'assistant', cwd: '/p',
      message: {
        role: 'model',
        parts: [
          { text: 'plan it', thought: true },
          { text: 'doing it' },
          { functionCall: { name: 'bash', args: { cmd: 'ls' } } }
        ]
      }
    });
    const events = parseQwenTranscriptLine(line);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(['thinking', 'message', 'tool_call']);
  });
  it('skips type=system', () => {
    expect(parseQwenTranscriptLine(JSON.stringify({
      type: 'system', cwd: '/p', subtype: 'ui_telemetry'
    }))).toEqual([]);
  });
  it('returns [] for malformed JSON', () => {
    expect(parseQwenTranscriptLine('garbage')).toEqual([]);
  });

  // QWEN delta-1 regression (2026-05-15): real qwen disk has top-level
  // `tool_result` rows with role=user + parts[].functionResponse —
  // earlier parser dropped them.
  it('parses real-shape tool_result row with functionResponse.response.output', () => {
    const line = JSON.stringify({
      type: 'tool_result',
      cwd: '/Users/test',
      message: {
        role: 'user',
        parts: [{
          functionResponse: {
            id: 'call_xyz',
            name: 'read_file',
            response: { output: 'file body content here' }
          }
        }]
      }
    });
    expect(parseQwenTranscriptLine(line)).toEqual([
      { kind: 'message', text: 'file body content here', trust: 'high' }
    ]);
  });

  it('parses tool_result with response as string (older shape)', () => {
    const line = JSON.stringify({
      type: 'tool_result',
      message: {
        role: 'user',
        parts: [{ functionResponse: { name: 'agent', response: 'Subagent failed' } }]
      }
    });
    expect(parseQwenTranscriptLine(line)).toEqual([
      { kind: 'message', text: 'Subagent failed', trust: 'high' }
    ]);
  });
});

describe('readCwdFromQwenLine', () => {
  it('extracts cwd from any qwen line', () => {
    expect(readCwdFromQwenLine(JSON.stringify({
      type: 'user', cwd: '/Users/test'
    }))).toBe('/Users/test');
  });
});

describe('readContextFillFromQwenUsageLine', () => {
  it('extracts Qwen context fill from assistant usageMetadata', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { usageMetadata: { promptTokenCount: 65_536, cachedContentTokenCount: 65_536 } }
    });

    expect(readContextFillFromQwenUsageLine(line)).toEqual({
      fill: 0.5,
      inputTokens: 131_072,
      contextWindow: 262_144
    });
  });

  it('extracts Qwen context fill from api_response telemetry rows', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'ui_telemetry',
      systemPayload: {
        uiEvent: {
          'event.name': 'qwen-code.api_response',
          input_token_count: 100_000,
          cached_content_token_count: 31_072
        }
      }
    });

    expect(readContextFillFromQwenUsageLine(line)?.fill).toBeCloseTo(0.5);
  });
});

describe('ingestQwenTranscriptLine — DB roundtrip', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('persists assistant message as trust=high source=transcript', () => {
    const SID = 't_qwen_1';
    const line = JSON.stringify({
      type: 'assistant', cwd: '/p',
      message: { role: 'model', parts: [{ text: 'qwen reply body' }] }
    });
    expect(ingestQwenTranscriptLine(SID, line)).toBe(1);
    const events = listLatestTerminalRunEvents(SID, 5);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('message');
    expect(events[0].source).toBe('transcript');
  });

  it('persists context-fill from Qwen usageMetadata alongside run events', () => {
    const terminal = upsertTerminal({ pid: 424, pid_start: 'pst', name: 'qwen-context-fill-test' });
    const line = JSON.stringify({
      type: 'assistant',
      cwd: '/p',
      message: {
        role: 'model',
        parts: [{ text: 'qwen reply body' }],
        usageMetadata: { promptTokenCount: 65_536, cachedContentTokenCount: 65_536 }
      }
    });

    expect(ingestQwenTranscriptLine(terminal.id, line)).toBe(1);
    const row = getTerminalById(terminal.id);
    expect(row?.agent_context_fill).toBeCloseTo(0.5);
    expect(row?.agent_context_fill_source).toBe('qwen-transcript-usage');
    expect(typeof row?.agent_context_fill_at_ms).toBe('number');
  });
});
