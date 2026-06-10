import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseTranscriptLine, mapClaudeContentItem, encodedCwdSegmentFor,
  ingestTranscriptLine, readContextFillFromClaudeUsageLine, recordClaudeUsageFromLine
} from './claudeCodeTranscriptTail';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';
import { getTerminalById, upsertTerminal } from './terminalsStore';

describe('encodedCwdSegmentFor', () => {
  it('replaces / with - and prefixes', () => {
    expect(encodedCwdSegmentFor('/Users/you/CascadeProjects/ant'))
      .toBe('-Users-you-CascadeProjects-ant');
  });
});

describe('mapClaudeContentItem', () => {
  it('user text → kind=command', () => {
    expect(mapClaudeContentItem('user', { type: 'text', text: 'ls -la' }))
      .toEqual({ kind: 'command', text: 'ls -la', trust: 'high' });
  });

  it('user tool_result → kind=message (tool output to assistant)', () => {
    expect(mapClaudeContentItem('user', { type: 'tool_result', content: 'file contents here' }))
      .toEqual({ kind: 'message', text: 'file contents here', trust: 'high' });
  });

  it('assistant text → kind=message', () => {
    expect(mapClaudeContentItem('assistant', { type: 'text', text: 'Sure I can help' }))
      .toEqual({ kind: 'message', text: 'Sure I can help', trust: 'high' });
  });

  it('assistant thinking → kind=thinking', () => {
    expect(mapClaudeContentItem('assistant', { type: 'thinking', thinking: 'reasoning step' }))
      .toEqual({ kind: 'thinking', text: 'reasoning step', trust: 'high' });
  });

  it('assistant tool_use → kind=tool_call with serialized input', () => {
    const m = mapClaudeContentItem('assistant', {
      type: 'tool_use', name: 'Bash', input: { command: 'echo hi' }
    });
    expect(m?.kind).toBe('tool_call');
    expect(m?.text).toContain('Bash');
    expect(m?.text).toContain('echo hi');
  });

  it('returns null for empty text', () => {
    expect(mapClaudeContentItem('assistant', { type: 'text', text: '' })).toBeNull();
  });
});

describe('parseTranscriptLine', () => {
  it('parses user JSONL with text content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello world' }] }
    });
    expect(parseTranscriptLine(line)).toEqual([
      { kind: 'command', text: 'hello world', trust: 'high' }
    ]);
  });

  it('parses assistant with multiple content items (thinking + text + tool_use)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'text', text: 'here is the plan' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    });
    const events = parseTranscriptLine(line);
    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe('thinking');
    expect(events[1].kind).toBe('message');
    expect(events[2].kind).toBe('tool_call');
  });

  it('handles string-form message.content (older transcripts)', () => {
    const line = JSON.stringify({
      type: 'user', message: { role: 'user', content: 'just a string' }
    });
    expect(parseTranscriptLine(line)).toEqual([
      { kind: 'command', text: 'just a string', trust: 'high' }
    ]);
  });

  it('skips non user/assistant types (system/attachment/etc)', () => {
    expect(parseTranscriptLine(JSON.stringify({ type: 'system' }))).toEqual([]);
    expect(parseTranscriptLine(JSON.stringify({ type: 'attachment', attachment: {} }))).toEqual([]);
    expect(parseTranscriptLine(JSON.stringify({ type: 'last-prompt' }))).toEqual([]);
  });

  it('returns empty for malformed JSON', () => {
    expect(parseTranscriptLine('not json')).toEqual([]);
    expect(parseTranscriptLine('')).toEqual([]);
  });
});

describe('readContextFillFromClaudeUsageLine', () => {
  it('extracts Claude context fill from message usage counters', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 10_000,
          cache_read_input_tokens: 20_000,
          cache_creation_input_tokens: 10_000
        }
      }
    });

    expect(readContextFillFromClaudeUsageLine(line)).toEqual({
      fill: 0.2,
      inputTokens: 40_000,
      contextWindow: 200_000
    });
  });

  it('ignores malformed or non-usage Claude lines', () => {
    expect(readContextFillFromClaudeUsageLine('garbage')).toBeNull();
    expect(readContextFillFromClaudeUsageLine(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'hello' }
    }))).toBeNull();
  });
});

describe('ingestTranscriptLine — DB roundtrip', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('persists assistant text as kind=message + trust=high + source=transcript', () => {
    const SID = 't_tr_1';
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'reply body' }] }
    });
    const count = ingestTranscriptLine(SID, line);
    expect(count).toBe(1);
    const events = listLatestTerminalRunEvents(SID, 5);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('message');
    expect(events[0].text).toBe('reply body');
    expect(events[0].trust).toBe('high');
    expect(events[0].source).toBe('transcript');
  });

  it('persists multiple content items as separate rows in order', () => {
    const SID = 't_tr_2';
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'step 1' },
          { type: 'text', text: 'answer' }
        ]
      }
    });
    expect(ingestTranscriptLine(SID, line)).toBe(2);
    const events = listLatestTerminalRunEvents(SID, 5);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind).sort()).toEqual(['message', 'thinking']);
  });

  it('no-op for non user/assistant lines', () => {
    const SID = 't_tr_3';
    expect(ingestTranscriptLine(SID, JSON.stringify({ type: 'system' }))).toBe(0);
    expect(listLatestTerminalRunEvents(SID, 5)).toHaveLength(0);
  });

  it('persists context-fill from Claude usage lines alongside run events', () => {
    const terminal = upsertTerminal({ pid: 421, pid_start: 'pst', name: 'claude-context-fill-test' });
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'reply body' }],
        usage: {
          input_tokens: 10_000,
          cache_read_input_tokens: 20_000,
          cache_creation_input_tokens: 10_000
        }
      }
    });

    expect(ingestTranscriptLine(terminal.id, line)).toBe(1);
    const row = getTerminalById(terminal.id);
    expect(row?.agent_context_fill).toBeCloseTo(0.2);
    expect(row?.agent_context_fill_source).toBe('claude-transcript-usage');
    expect(typeof row?.agent_context_fill_at_ms).toBe('number');
  });
});

describe('recordClaudeUsageFromLine — token ledger feed', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM local_usage_events`).run(); } catch { /* table created by schema boot */ }
  });

  function ledgerRows() {
    return getIdentityDb()
      .prepare(`SELECT provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, source FROM local_usage_events ORDER BY occurred_at_ms`)
      .all() as Array<Record<string, unknown>>;
  }

  it('maps Claude usage 1:1 — fresh input, output, and both cache classes kept separate', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 120,
          output_tokens: 340,
          cache_read_input_tokens: 9000,
          cache_creation_input_tokens: 500
        }
      }
    });
    recordClaudeUsageFromLine(line);
    const rows = ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'claude',
      model: 'claude-opus-4-8',
      input_tokens: 120,       // FRESH only — cache NOT folded in
      output_tokens: 340,
      cache_read_tokens: 9000,
      cache_creation_tokens: 500,
      source: 'claude-transcript'
    });
  });

  it('records a fully cache-hit turn (input 0, output 0, cache_read > 0) — not dropped', () => {
    recordClaudeUsageFromLine(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 4096 } }
    }));
    expect(ledgerRows()).toHaveLength(1);
    expect(ledgerRows()[0].cache_read_tokens).toBe(4096);
  });

  it('ignores lines with no usage object + malformed JSON (best-effort, never throws)', () => {
    recordClaudeUsageFromLine(JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }));
    recordClaudeUsageFromLine('not json {');
    recordClaudeUsageFromLine('');
    expect(ledgerRows()).toHaveLength(0);
  });

  it('ingestTranscriptLine also feeds the token ledger (single wiring point)', () => {
    getIdentityDb().prepare(`DELETE FROM local_usage_events`).run();
    ingestTranscriptLine('t_usage_ingest', JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 50, output_tokens: 10 } }
    }));
    const rows = ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'claude', input_tokens: 50, output_tokens: 10, source: 'claude-transcript' });
  });
});
