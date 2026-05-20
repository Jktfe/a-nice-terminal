import { describe, it, expect } from 'vitest';
import { classifyCodex } from './codex';
import { dispatchClassify, resetClassifierBuffersForTests } from '../classifierRegistry';

describe('classifyCodex — T2c-impl-2-codex per-CLI parser', () => {
  it('maps `>` thinking-arrow lines to kind=thinking', () => {
    const result = classifyCodex('> reasoning about the file\nactual answer\n');
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual({ kind: 'thinking', text: '> reasoning about the file', trust: 'medium' });
    expect(result.events[1]).toEqual({ kind: 'message', text: 'actual answer', trust: 'medium' });
  });

  it('maps `▶` triangle-arrow to kind=thinking', () => {
    const result = classifyCodex('▶ planning step\n');
    expect(result.events[0].kind).toBe('thinking');
  });

  it('maps `[thinking]` prefix to kind=thinking case-insensitive', () => {
    const result = classifyCodex('[Thinking] long-form reasoning\n');
    expect(result.events[0].kind).toBe('thinking');
  });

  it('maps `$ <cmd>` shell shape to kind=command', () => {
    const result = classifyCodex('$ ls -la\n');
    expect(result.events[0].kind).toBe('command');
  });

  it('maps `> $ <cmd>` chained shell shape to kind=command (beats generic > thinking)', () => {
    const result = classifyCodex('> $ ls -la\n');
    expect(result.events[0].kind).toBe('command');
  });

  it('lines with residual control bytes demote to kind=raw not message (delta-5)', () => {
    const result = classifyCodex('clean text\nweird\x01control\nplain\n');
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(['message', 'raw', 'message']);
  });

  it('bare command-like lines without `$` or `> $` prefix classify as message', () => {
    // Per codex output contract: codex itself emits commands prefixed with
    // `$ ` or `> $ `; bare lines like `ls -la` are output text, not commands.
    // Locked here to prevent silent reclassification when rules evolve.
    const result = classifyCodex('ls -la\n');
    expect(result.events[0].kind).toBe('message');
  });

  it('maps `[tool]` / `[tool_use]` / `[tool_call]` prefixes to kind=tool_call', () => {
    const result = classifyCodex('[tool] read_file\n[tool_use] x\n[tool_call] y\n');
    expect(result.events.map((e) => e.kind)).toEqual(['tool_call', 'tool_call', 'tool_call']);
  });

  it('falls back to kind=message for plain text', () => {
    const result = classifyCodex('plain output line\n');
    expect(result.events[0].kind).toBe('message');
  });

  it('preserves trailing partial line in remaining', () => {
    const result = classifyCodex('full line\nincomplete');
    expect(result.events).toHaveLength(1);
    expect(result.remaining).toBe('incomplete');
  });

  it('handles empty buffer', () => {
    expect(classifyCodex('')).toEqual({ events: [], remaining: '' });
  });

  it('integration via dispatchClassify with codex agentKindHint', () => {
    resetClassifierBuffersForTests();
    const events = dispatchClassify({
      sessionId: 't_codex_int',
      chunk: '> thinking out loud\n$ ls\nresult line\n',
      agentKindHint: 'codex'
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('thinking');
    expect(kinds).toContain('command');
    expect(kinds).toContain('message');
  });

  it('codex-cli alias also dispatches to classifyCodex', () => {
    resetClassifierBuffersForTests();
    const events = dispatchClassify({
      sessionId: 't_codex_alias',
      chunk: '> alias-test\n',
      agentKindHint: 'codex-cli'
    });
    expect(events[0].kind).toBe('thinking');
  });
});
