/**
 * cliHookEventsStore tests — CLI-HOOK-BRIDGE Phase 1A
 * (2026-05-15, JWPK Slice B follow-up).
 *
 * Covers the insert + query primitives the receiver endpoint and the
 * future UI layer both consume. Per-worker DB isolation comes from
 * db.ts:resolveDbFilePath via VITEST_WORKER_ID.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  insertCliHookEvent,
  listCliHookEventsForSession,
  listRecentCliHookEvents,
  getLatestCliHookEventForSession,
  resetCliHookEventsStoreForTests
} from './cliHookEventsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

describe('cliHookEventsStore', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-cli-hook-events-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetCliHookEventsStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  });

  it('round-trips a minimal event with default source_cli = claude-code', () => {
    const before = Date.now();
    const inserted = insertCliHookEvent({
      sessionId: 'sess-1',
      hookEventName: 'SessionStart',
      payload: { hook_event_name: 'SessionStart', session_id: 'sess-1' }
    });
    const after = Date.now();

    expect(inserted.source_cli).toBe('claude-code');
    expect(inserted.session_id).toBe('sess-1');
    expect(inserted.hook_event_name).toBe('SessionStart');
    expect(inserted.received_at_ms).toBeGreaterThanOrEqual(before);
    expect(inserted.received_at_ms).toBeLessThanOrEqual(after);
    expect(inserted.id).toBeGreaterThan(0);
    expect(JSON.parse(inserted.payload).session_id).toBe('sess-1');
  });

  it('persists promoted columns when supplied', () => {
    const inserted = insertCliHookEvent({
      sessionId: 'sess-2',
      hookEventName: 'PreToolUse',
      transcriptPath: '/tmp/transcript.jsonl',
      cwd: '/Users/x/proj',
      permissionMode: 'default',
      effortLevel: 'high',
      toolName: 'Bash',
      toolUseId: 'tu_abc',
      payload: {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-2',
        tool_name: 'Bash',
        tool_input: { command: 'ls' }
      }
    });
    expect(inserted.transcript_path).toBe('/tmp/transcript.jsonl');
    expect(inserted.cwd).toBe('/Users/x/proj');
    expect(inserted.permission_mode).toBe('default');
    expect(inserted.effort_level).toBe('high');
    expect(inserted.tool_name).toBe('Bash');
    expect(inserted.tool_use_id).toBe('tu_abc');
  });

  it('honours a non-default source_cli', () => {
    const inserted = insertCliHookEvent({
      sourceCli: 'codex',
      sessionId: 'sess-codex',
      hookEventName: 'PreToolUse',
      payload: {}
    });
    expect(inserted.source_cli).toBe('codex');
  });

  it('rejects a blank sessionId', () => {
    expect(() =>
      insertCliHookEvent({ sessionId: '   ', hookEventName: 'X', payload: {} })
    ).toThrow(/sessionId/);
  });

  it('rejects a blank hookEventName', () => {
    expect(() =>
      insertCliHookEvent({ sessionId: 'sess', hookEventName: '   ', payload: {} })
    ).toThrow(/hookEventName/);
  });

  it('listCliHookEventsForSession returns events newest-first', async () => {
    insertCliHookEvent({ sessionId: 'sess', hookEventName: 'A', payload: {}, receivedAtMs: 1000 });
    insertCliHookEvent({ sessionId: 'sess', hookEventName: 'B', payload: {}, receivedAtMs: 2000 });
    insertCliHookEvent({ sessionId: 'sess', hookEventName: 'C', payload: {}, receivedAtMs: 3000 });
    const events = listCliHookEventsForSession('sess');
    expect(events.map((e) => e.hook_event_name)).toEqual(['C', 'B', 'A']);
  });

  it('listCliHookEventsForSession isolates by session_id', () => {
    insertCliHookEvent({ sessionId: 's1', hookEventName: 'one', payload: {}, receivedAtMs: 100 });
    insertCliHookEvent({ sessionId: 's2', hookEventName: 'two', payload: {}, receivedAtMs: 200 });
    expect(listCliHookEventsForSession('s1').map((e) => e.hook_event_name)).toEqual(['one']);
    expect(listCliHookEventsForSession('s2').map((e) => e.hook_event_name)).toEqual(['two']);
  });

  it('getLatestCliHookEventForSession returns the most recent row', () => {
    insertCliHookEvent({ sessionId: 'sess', hookEventName: 'older', payload: {}, receivedAtMs: 100 });
    insertCliHookEvent({ sessionId: 'sess', hookEventName: 'newer', payload: {}, receivedAtMs: 999 });
    expect(getLatestCliHookEventForSession('sess')?.hook_event_name).toBe('newer');
  });

  it('getLatestCliHookEventForSession returns undefined for unknown session', () => {
    expect(getLatestCliHookEventForSession('phantom')).toBeUndefined();
  });

  it('listRecentCliHookEvents returns all CLIs newest-first by default', () => {
    insertCliHookEvent({ sourceCli: 'claude-code', sessionId: 'a', hookEventName: 'cc', payload: {}, receivedAtMs: 100 });
    insertCliHookEvent({ sourceCli: 'codex', sessionId: 'b', hookEventName: 'cx', payload: {}, receivedAtMs: 200 });
    insertCliHookEvent({ sourceCli: 'gemini', sessionId: 'c', hookEventName: 'gm', payload: {}, receivedAtMs: 300 });
    const events = listRecentCliHookEvents();
    expect(events.map((e) => e.hook_event_name)).toEqual(['gm', 'cx', 'cc']);
  });

  it('listRecentCliHookEvents filters by source_cli when supplied', () => {
    insertCliHookEvent({ sourceCli: 'claude-code', sessionId: 'a', hookEventName: 'cc', payload: {}, receivedAtMs: 100 });
    insertCliHookEvent({ sourceCli: 'codex', sessionId: 'b', hookEventName: 'cx', payload: {}, receivedAtMs: 200 });
    insertCliHookEvent({ sourceCli: 'claude-code', sessionId: 'a', hookEventName: 'cc2', payload: {}, receivedAtMs: 300 });
    const events = listRecentCliHookEvents({ sourceCli: 'claude-code' });
    expect(events.map((e) => e.hook_event_name)).toEqual(['cc2', 'cc']);
  });

  it('listRecentCliHookEvents honours limit', () => {
    for (let i = 0; i < 10; i++) {
      insertCliHookEvent({ sessionId: 's', hookEventName: `e${i}`, payload: {}, receivedAtMs: i });
    }
    expect(listRecentCliHookEvents({ limit: 3 })).toHaveLength(3);
  });

  it('payload survives JSON round-trip', () => {
    const richPayload = {
      hook_event_name: 'PreToolUse',
      session_id: 'sess',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi', timeout: 5000, run_in_background: false }
    };
    insertCliHookEvent({
      sessionId: 'sess',
      hookEventName: 'PreToolUse',
      payload: richPayload
    });
    const [row] = listCliHookEventsForSession('sess');
    const parsed = JSON.parse(row.payload);
    expect(parsed.tool_input.command).toBe('echo hi');
    expect(parsed.tool_input.timeout).toBe(5000);
  });
});
