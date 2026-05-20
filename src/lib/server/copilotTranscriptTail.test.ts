import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapCopilotEvent, parseCopilotTranscriptLine, ingestCopilotTranscriptLine,
  readCwdFromCopilotSessionStartLine
} from './copilotTranscriptTail';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';

describe('mapCopilotEvent', () => {
  it('user.message → command', () => {
    expect(mapCopilotEvent({ type: 'user.message', data: { content: 'hi copilot' } }))
      .toEqual([{ kind: 'command', text: 'hi copilot', trust: 'high' }]);
  });

  it('assistant.message text + toolRequests → message + tool_call(s)', () => {
    const r = mapCopilotEvent({
      type: 'assistant.message',
      data: {
        content: 'reply body',
        toolRequests: [
          { toolCallId: 'c1', name: 'bash', arguments: { cmd: 'ls' } },
          { toolCallId: 'c2', name: 'read_file', arguments: { path: '/x' } }
        ]
      }
    });
    expect(r).toHaveLength(3);
    expect(r[0].kind).toBe('message');
    expect(r[1].kind).toBe('tool_call');
    expect(r[1].text).toContain('bash');
    expect(r[2].kind).toBe('tool_call');
    expect(r[2].text).toContain('read_file');
  });

  it('assistant.message with empty text + tools → only tool_calls', () => {
    const r = mapCopilotEvent({
      type: 'assistant.message',
      data: {
        content: '',
        toolRequests: [{ toolCallId: 'c1', name: 'bash', arguments: { cmd: 'ls' } }]
      }
    });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('tool_call');
  });

  it('tool.execution_complete → message (result body)', () => {
    expect(mapCopilotEvent({
      type: 'tool.execution_complete',
      data: { result: { content: 'tool output' } }
    })).toEqual([{ kind: 'message', text: 'tool output', trust: 'high' }]);
  });

  it('skips system.message + session.* + hook.* + abort + others', () => {
    expect(mapCopilotEvent({ type: 'system.message', data: { content: 'sys' } })).toEqual([]);
    expect(mapCopilotEvent({ type: 'session.start', data: { context: { cwd: '/p' } } })).toEqual([]);
    expect(mapCopilotEvent({ type: 'session.shutdown', data: {} })).toEqual([]);
    expect(mapCopilotEvent({ type: 'hook.start', data: {} })).toEqual([]);
    expect(mapCopilotEvent({ type: 'abort', data: {} })).toEqual([]);
    expect(mapCopilotEvent({ type: 'assistant.turn_start', data: {} })).toEqual([]);
  });
});

describe('parseCopilotTranscriptLine', () => {
  it('parses user.message line', () => {
    const line = JSON.stringify({
      type: 'user.message', data: { content: 'go' }
    });
    expect(parseCopilotTranscriptLine(line)).toEqual([
      { kind: 'command', text: 'go', trust: 'high' }
    ]);
  });

  it('returns [] for malformed JSON', () => {
    expect(parseCopilotTranscriptLine('garbage')).toEqual([]);
  });
});

describe('readCwdFromCopilotSessionStartLine', () => {
  it('extracts cwd from session.start.data.context.cwd', () => {
    const line = JSON.stringify({
      type: 'session.start',
      data: { context: { cwd: '/Users/test/x', branch: 'main' } }
    });
    expect(readCwdFromCopilotSessionStartLine(line)).toBe('/Users/test/x');
  });

  it('returns null for non-session.start', () => {
    expect(readCwdFromCopilotSessionStartLine(JSON.stringify({ type: 'user.message' }))).toBeNull();
  });
});

describe('ingestCopilotTranscriptLine — DB roundtrip', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('persists assistant text as kind=message trust=high source=transcript', () => {
    const SID = 't_cop_1';
    const line = JSON.stringify({
      type: 'assistant.message',
      data: { content: 'copilot reply' }
    });
    expect(ingestCopilotTranscriptLine(SID, line)).toBe(1);
    const events = listLatestTerminalRunEvents(SID, 5);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('message');
    expect(events[0].source).toBe('transcript');
  });

  it('no-op for hook/system/etc events', () => {
    const SID = 't_cop_2';
    expect(ingestCopilotTranscriptLine(SID, JSON.stringify({
      type: 'hook.start', data: {}
    }))).toBe(0);
  });
});
