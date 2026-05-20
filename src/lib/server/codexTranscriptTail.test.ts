import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapCodexEvent, parseCodexTranscriptLine, ingestCodexTranscriptLine,
  readCwdFromSessionMetaLine
} from './codexTranscriptTail';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';

describe('mapCodexEvent — pure', () => {
  it('response_item message user input_text → kind=command', () => {
    expect(mapCodexEvent({
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'do thing' }] }
    })).toEqual([{ kind: 'command', text: 'do thing', trust: 'high' }]);
  });

  it('response_item message assistant output_text → kind=message', () => {
    expect(mapCodexEvent({
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'reply body' }] }
    })).toEqual([{ kind: 'message', text: 'reply body', trust: 'high' }]);
  });

  it('response_item message developer/system → SKIP', () => {
    expect(mapCodexEvent({
      type: 'response_item',
      payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'system prompt' }] }
    })).toEqual([]);
    expect(mapCodexEvent({
      type: 'response_item',
      payload: { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'system' }] }
    })).toEqual([]);
  });

  it('response_item reasoning summary[].text → kind=thinking', () => {
    expect(mapCodexEvent({
      type: 'response_item',
      payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'reasoning step' }] }
    })).toEqual([{ kind: 'thinking', text: 'reasoning step', trust: 'high' }]);
  });

  it('response_item function_call → kind=tool_call with name + arguments', () => {
    const r = mapCodexEvent({
      type: 'response_item',
      payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls"}' }
    });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('tool_call');
    expect(r[0].text).toContain('exec_command');
    expect(r[0].text).toContain('ls');
  });

  it('response_item function_call_output → kind=message (tool result)', () => {
    expect(mapCodexEvent({
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'file listing' }
    })).toEqual([{ kind: 'message', text: 'file listing', trust: 'high' }]);
  });

  it('event_msg / session_meta / turn_context all SKIP', () => {
    expect(mapCodexEvent({ type: 'event_msg', payload: { type: 'agent_message' } })).toEqual([]);
    expect(mapCodexEvent({ type: 'event_msg', payload: { type: 'user_message' } })).toEqual([]);
    expect(mapCodexEvent({ type: 'event_msg', payload: { type: 'agent_reasoning' } })).toEqual([]);
    expect(mapCodexEvent({ type: 'session_meta', payload: { cwd: '/foo' } })).toEqual([]);
    expect(mapCodexEvent({ type: 'turn_context', payload: { cwd: '/foo' } })).toEqual([]);
  });

  it('returns empty for empty/missing content/output', () => {
    expect(mapCodexEvent({
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [] }
    })).toEqual([]);
    expect(mapCodexEvent({
      type: 'response_item',
      payload: { type: 'function_call_output', output: '' }
    })).toEqual([]);
  });
});

describe('parseCodexTranscriptLine', () => {
  it('parses a real-shape user message line', () => {
    const line = JSON.stringify({
      timestamp: '...',
      type: 'response_item',
      payload: {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: 'hello codex' }]
      }
    });
    expect(parseCodexTranscriptLine(line)).toEqual([
      { kind: 'command', text: 'hello codex', trust: 'high' }
    ]);
  });

  it('returns empty for malformed JSON / empty', () => {
    expect(parseCodexTranscriptLine('not json')).toEqual([]);
    expect(parseCodexTranscriptLine('')).toEqual([]);
  });
});

describe('readCwdFromSessionMetaLine', () => {
  it('extracts cwd from session_meta', () => {
    const line = JSON.stringify({
      type: 'session_meta',
      payload: { id: 'abc', cwd: '/Users/jamesking/work', cli_version: 'X' }
    });
    expect(readCwdFromSessionMetaLine(line)).toBe('/Users/jamesking/work');
  });

  it('returns null for non-session_meta lines', () => {
    expect(readCwdFromSessionMetaLine(JSON.stringify({
      type: 'turn_context', payload: { cwd: '/foo' }
    }))).toBeNull();
  });

  it('returns null for malformed lines', () => {
    expect(readCwdFromSessionMetaLine('garbage')).toBeNull();
    expect(readCwdFromSessionMetaLine('')).toBeNull();
  });
});

describe('ingestCodexTranscriptLine — DB roundtrip', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('persists assistant output as kind=message trust=high source=transcript', () => {
    const SID = 't_codex_1';
    const line = JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: 'here is the answer' }]
      }
    });
    expect(ingestCodexTranscriptLine(SID, line)).toBe(1);
    const events = listLatestTerminalRunEvents(SID, 5);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('message');
    expect(events[0].text).toBe('here is the answer');
    expect(events[0].trust).toBe('high');
    expect(events[0].source).toBe('transcript');
  });

  it('no-op for event_msg lines (avoid response_item dup)', () => {
    const SID = 't_codex_2';
    expect(ingestCodexTranscriptLine(SID, JSON.stringify({
      type: 'event_msg', payload: { type: 'agent_message', message: 'dup body' }
    }))).toBe(0);
    expect(listLatestTerminalRunEvents(SID, 5)).toHaveLength(0);
  });
});
