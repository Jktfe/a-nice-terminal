/**
 * piAdapter tests — CLI-HOOK-BRIDGE Phase 3 (2026-05-15).
 *
 * Covers:
 *   - Pure translation (translatePiEvent) for each event type
 *   - LF-only line framing (the U+2028 hazard banked in feedback)
 *   - End-to-end stdout-bytes → cli_hook_events through the JSONL reader
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attachPiAdapter,
  makePiAdapterState,
  makePiJsonlLineReader,
  translatePiEvent
} from './piAdapter';
import {
  listCliHookEventsForSession,
  resetCliHookEventsStoreForTests
} from '../cliHookEventsStore';
import { resetIdentityDbForTests } from '../db';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;

describe('makePiJsonlLineReader — LF-only framing', () => {
  it('splits LF-delimited lines and ignores empty ones', () => {
    const lines: string[] = [];
    const reader = makePiJsonlLineReader((l) => lines.push(l));
    reader.feed('first\nsecond\n\nthird\n');
    expect(lines).toEqual(['first', 'second', 'third']);
  });

  it('strips a trailing \\r before LF (CR-tolerant)', () => {
    const lines: string[] = [];
    const reader = makePiJsonlLineReader((l) => lines.push(l));
    reader.feed('with-cr\r\nplain\n');
    expect(lines).toEqual(['with-cr', 'plain']);
  });

  it('does NOT split on Unicode U+2028 / U+2029 (the readline hazard)', () => {
    const lines: string[] = [];
    const reader = makePiJsonlLineReader((l) => lines.push(l));
    // U+2028 LINE SEPARATOR + U+2029 PARAGRAPH SEPARATOR are valid INSIDE
    // JSON strings. The reader must keep these in a single line — only
    // 0x0A (LF) is a delimiter.
    reader.feed('{"line":"hello world more"}\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(' ');
    expect(lines[0]).toContain(' ');
  });

  it('handles partial reads across chunk boundaries', () => {
    const lines: string[] = [];
    const reader = makePiJsonlLineReader((l) => lines.push(l));
    reader.feed('{"a":');
    reader.feed('1}\n{"b":');
    reader.feed('2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('flushes a final line without trailing LF on end()', () => {
    const lines: string[] = [];
    const reader = makePiJsonlLineReader((l) => lines.push(l));
    reader.feed('first\nsecond');
    reader.end();
    expect(lines).toEqual(['first', 'second']);
  });

  it('handles UTF-8 multibyte sequences split across chunks', () => {
    const lines: string[] = [];
    const reader = makePiJsonlLineReader((l) => lines.push(l));
    // "café" — the é is 0xC3 0xA9. Split between the two bytes:
    const part1 = Buffer.from([0x63, 0x61, 0x66, 0xC3]); // "caf<half-é>"
    const part2 = Buffer.from([0xA9, 0x0A]);             // "<rest-of-é>\n"
    reader.feed(part1);
    reader.feed(part2);
    expect(lines).toEqual(['café']);
  });
});

describe('translatePiEvent (pure)', () => {
  it('returns null when currentSessionId is unset', () => {
    const state = makePiAdapterState();
    expect(translatePiEvent({ type: 'tool_execution_start', toolName: 'bash' }, state)).toBeNull();
  });

  it('agent_start maps to SessionStart once, then to UserPromptSubmit on subsequent', () => {
    const state = makePiAdapterState();
    state.currentSessionId = 'sess-1';
    const first = translatePiEvent({ type: 'agent_start' }, state);
    expect(first?.hookEventName).toBe('SessionStart');
    const second = translatePiEvent({ type: 'agent_start' }, state);
    expect(second?.hookEventName).toBe('UserPromptSubmit');
  });

  it('tool_execution_start carries toolName + toolUseId', () => {
    const state = makePiAdapterState();
    state.currentSessionId = 'sess-1';
    const result = translatePiEvent(
      { type: 'tool_execution_start', toolName: 'bash', toolCallId: 'tc_abc', args: { command: 'ls' } },
      state
    );
    expect(result?.hookEventName).toBe('PreToolUse');
    expect(result?.toolName).toBe('bash');
    expect(result?.toolUseId).toBe('tc_abc');
  });

  it('tool_execution_end maps to PostToolUse', () => {
    const state = makePiAdapterState();
    state.currentSessionId = 'sess-1';
    const result = translatePiEvent(
      { type: 'tool_execution_end', toolName: 'bash', toolCallId: 'tc_abc', result: 'ok', isError: false },
      state
    );
    expect(result?.hookEventName).toBe('PostToolUse');
  });

  it('compaction_start/end maps to PreCompact/PostCompact', () => {
    const state = makePiAdapterState();
    state.currentSessionId = 'sess-1';
    expect(translatePiEvent({ type: 'compaction_start', reason: 'threshold' }, state)?.hookEventName).toBe('PreCompact');
    expect(translatePiEvent({ type: 'compaction_end', aborted: false }, state)?.hookEventName).toBe('PostCompact');
  });

  it('drops noisy delta events (message_update, tool_execution_update, queue_update, extension_ui_request)', () => {
    const state = makePiAdapterState();
    state.currentSessionId = 'sess-1';
    for (const type of ['message_update', 'tool_execution_update', 'queue_update', 'extension_ui_request']) {
      expect(translatePiEvent({ type }, state)).toBeNull();
    }
  });

  it('unknown event type persists as PiEvent:<type> for forensic value', () => {
    const state = makePiAdapterState();
    state.currentSessionId = 'sess-1';
    const result = translatePiEvent({ type: 'something_new', extra: 'data' }, state);
    expect(result?.hookEventName).toBe('PiEvent:something_new');
  });
});

describe('attachPiAdapter — full stdout pipeline', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-pi-adapter-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetCliHookEventsStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbEnv;
  });

  it('parses a stream of LF-JSONL events and persists translated ones', () => {
    const state = makePiAdapterState();
    state.currentSessionId = 'sess-stream';
    const adapter = attachPiAdapter(state);

    const eventsAsJsonl = [
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 't1', args: { command: 'ls' } }),
      JSON.stringify({ type: 'tool_execution_update', toolCallId: 't1', partialResult: 'partial' }),
      JSON.stringify({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: 'ok' }),
      JSON.stringify({ type: 'agent_end' })
    ].join('\n') + '\n';

    adapter.feedStdout(eventsAsJsonl);
    expect(adapter.persistedCount).toBe(4); // agent_start, tool_start, tool_end, agent_end
    expect(adapter.droppedCount).toBe(1);   // tool_execution_update
    const rows = listCliHookEventsForSession('sess-stream');
    expect(rows.map((r) => r.hook_event_name).reverse()).toEqual([
      'SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'
    ]);
  });

  it('skips RPC responses (lines with `id` field) and counts malformed lines', () => {
    const state = makePiAdapterState();
    state.currentSessionId = 'sess-skip';
    const adapter = attachPiAdapter(state);
    adapter.feedStdout(
      JSON.stringify({ type: 'agent_start' }) + '\n' +
      JSON.stringify({ id: 'cmd-1', type: 'response', result: { ok: true } }) + '\n' +
      'this is not JSON\n' +
      JSON.stringify({ type: 'agent_end' }) + '\n'
    );
    expect(adapter.persistedCount).toBe(2); // agent_start + agent_end
    expect(adapter.malformedCount).toBe(1); // "this is not JSON"
  });
});
