import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchClassify, resetClassifierBuffersForTests } from './classifierRegistry';
import { classifyGeneric } from './classifiers/generic';
import { classifyClaudeCode } from './classifiers/claudeCode';

describe('classifyGeneric', () => {
  it('emits one message per complete line, retains partial in remaining', () => {
    const result = classifyGeneric('hello\nworld\npartial');
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual({ kind: 'message', text: 'hello', trust: 'medium' });
    expect(result.events[1]).toEqual({ kind: 'message', text: 'world', trust: 'medium' });
    expect(result.remaining).toBe('partial');
  });

  it('demotes lines containing residual control bytes to kind=raw (delta-3)', () => {
    const result = classifyGeneric('clean\nhas\x01control\nplain\n');
    expect(result.events.map((e) => e.kind)).toEqual(['message', 'raw', 'message']);
    expect(result.events[1].trust).toBe('raw');
  });

  it('demotes shell-prompt lines to kind=raw via shared filter', () => {
    const result = classifyGeneric('user@host:~$\n');
    expect(result.events[0].kind).toBe('raw');
  });

  it('returns empty for empty buffer', () => {
    const result = classifyGeneric('');
    expect(result.events).toEqual([]);
    expect(result.remaining).toBe('');
  });
});

describe('classifyClaudeCode', () => {
  it('maps [thinking] / [tool] / [tool_use] prefixes to kinds; default message', () => {
    const result = classifyClaudeCode('[thinking] reasoning\n[tool] running ls\n[tool_use] x\nplain text\n');
    expect(result.events).toHaveLength(4);
    expect(result.events[0]).toEqual({ kind: 'thinking', text: '[thinking] reasoning', trust: 'medium' });
    expect(result.events[1]).toEqual({ kind: 'tool_call', text: '[tool] running ls', trust: 'medium' });
    expect(result.events[2]).toEqual({ kind: 'tool_call', text: '[tool_use] x', trust: 'medium' });
    expect(result.events[3]).toEqual({ kind: 'message', text: 'plain text', trust: 'medium' });
    expect(result.remaining).toBe('');
  });

  it('is case-insensitive on prefix detection', () => {
    const result = classifyClaudeCode('[Thinking] reasoning\n');
    expect(result.events[0].kind).toBe('thinking');
  });
});

describe('dispatchClassify (registry)', () => {
  beforeEach(() => resetClassifierBuffersForTests());

  it('falls back to generic when agentKindHint is null/unknown', () => {
    const events = dispatchClassify({ sessionId: 's1', chunk: 'one\ntwo\n', agentKindHint: null });
    expect(events.map((e) => e.kind)).toEqual(['message', 'message']);
  });

  it('uses claudeCode classifier when hint matches', () => {
    const events = dispatchClassify({ sessionId: 's1', chunk: '[thinking] x\n', agentKindHint: 'claude-code' });
    expect(events[0].kind).toBe('thinking');
  });

  it('uses codex classifier when hint matches (Layer B routing live-path)', () => {
    const events = dispatchClassify({
      sessionId: 's1b', chunk: '> reasoning\n$ ls\n[tool] x\nplain\n', agentKindHint: 'codex'
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('thinking');
    expect(kinds).toContain('command');
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('message');
  });

  it('persists buffer across chunks until newline arrives', () => {
    const first = dispatchClassify({ sessionId: 's2', chunk: 'partial', agentKindHint: null });
    expect(first).toEqual([]);
    const second = dispatchClassify({ sessionId: 's2', chunk: ' more\n', agentKindHint: null });
    expect(second).toHaveLength(1);
    expect(second[0].text).toBe('partial more');
  });

  it('emits raw fallback when buffer exceeds 8KB without newline', () => {
    const big = 'x'.repeat(9000);
    const events = dispatchClassify({ sessionId: 's3', chunk: big, agentKindHint: null });
    const raw = events.find((e) => e.kind === 'raw');
    expect(raw).toBeDefined();
    expect(raw?.text.length).toBeGreaterThan(8000);
  });
});
