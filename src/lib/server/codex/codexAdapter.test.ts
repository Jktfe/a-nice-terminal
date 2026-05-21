/**
 * codexAdapter tests — CLI-HOOK-BRIDGE Phase 2 (2026-05-15).
 *
 * Exercises the pure translation logic + the subscription glue against a
 * mock notification emitter, with no real codex binary in scope.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attachCodexAdapter,
  makeCodexAdapterState,
  translateCodexNotification,
  type CodexNotificationSource
} from './codexAdapter';
import {
  listCliHookEventsForSession,
  resetCliHookEventsStoreForTests
} from '../cliHookEventsStore';
import { resetIdentityDbForTests } from '../db';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;

class MockEmitter implements CodexNotificationSource {
  private handlers = new Map<string, (params: unknown) => void>();
  onNotification(method: string, handler: (params: unknown) => void): void {
    this.handlers.set(method, handler);
  }
  emit(method: string, params: unknown): void {
    const h = this.handlers.get(method);
    if (h) h(params);
  }
}

describe('codexAdapter translation (pure)', () => {
  it('thread/started seeds currentThreadId and emits SessionStart', () => {
    const state = makeCodexAdapterState();
    const result = translateCodexNotification(
      { method: 'thread/started', params: { thread: { id: 'thread-abc', status: 'ready' } } },
      state
    );
    expect(state.currentThreadId).toBe('thread-abc');
    expect(result).toMatchObject({
      sourceCli: 'codex',
      sessionId: 'thread-abc',
      hookEventName: 'SessionStart'
    });
  });

  it('turn/started without prior thread/started returns null', () => {
    const state = makeCodexAdapterState();
    const result = translateCodexNotification(
      { method: 'turn/started', params: { turn: { id: 't-1' } } },
      state
    );
    expect(result).toBeNull();
  });

  it('turn/started after thread/started uses currentThreadId', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-xyz';
    const result = translateCodexNotification(
      { method: 'turn/started', params: { turn: { id: 't-1' } } },
      state
    );
    expect(result).toMatchObject({ sessionId: 'thread-xyz', hookEventName: 'UserPromptSubmit' });
  });

  it('turn/completed maps to Stop with status preserved in payload', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-1';
    const result = translateCodexNotification(
      { method: 'turn/completed', params: { turn: { id: 't-9', status: 'completed' } } },
      state
    );
    expect(result?.hookEventName).toBe('Stop');
    expect((result?.payload as { status: string }).status).toBe('completed');
  });

  it('item/started for commandExecution maps to PreToolUse with tool=Bash', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-1';
    const result = translateCodexNotification(
      { method: 'item/started', params: { item: { id: 'item-99', type: 'commandExecution' } } },
      state
    );
    expect(result?.hookEventName).toBe('PreToolUse');
    expect(result?.toolName).toBe('Bash');
    expect(result?.toolUseId).toBe('item-99');
  });

  it('item/completed for fileChange maps to PostToolUse with tool=FileChange', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-1';
    const result = translateCodexNotification(
      { method: 'item/completed', params: { item: { id: 'item-fc-1', type: 'fileChange' } } },
      state
    );
    expect(result?.hookEventName).toBe('PostToolUse');
    expect(result?.toolName).toBe('FileChange');
  });

  it('item/started for mcpToolCall includes mcp:<name> as tool', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-1';
    const result = translateCodexNotification(
      { method: 'item/started', params: { item: { id: 'm1', type: 'mcpToolCall', name: 'fetch' } } },
      state
    );
    expect(result?.toolName).toBe('mcp:fetch');
  });

  it('contextCompaction maps to Pre/PostCompact based on phase', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-1';
    expect(translateCodexNotification(
      { method: 'item/started', params: { item: { id: 'c', type: 'contextCompaction' } } },
      state
    )?.hookEventName).toBe('PreCompact');
    expect(translateCodexNotification(
      { method: 'item/completed', params: { item: { id: 'c', type: 'contextCompaction' } } },
      state
    )?.hookEventName).toBe('PostCompact');
  });

  it('item/agentMessage/delta is DROPPED (returns null)', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-1';
    const result = translateCodexNotification(
      { method: 'item/agentMessage/delta', params: { itemId: 'm-1', delta: 'hello' } },
      state
    );
    expect(result).toBeNull();
  });

  it('userMessage item kind maps to UserPromptSubmit / UserPromptCompleted', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-1';
    expect(translateCodexNotification(
      { method: 'item/started', params: { item: { id: 'u', type: 'userMessage' } } },
      state
    )?.hookEventName).toBe('UserPromptSubmit');
    expect(translateCodexNotification(
      { method: 'item/completed', params: { item: { id: 'u', type: 'userMessage' } } },
      state
    )?.hookEventName).toBe('UserPromptCompleted');
  });

  it('unknown item kind falls through to ItemStart:<kind>', () => {
    const state = makeCodexAdapterState();
    state.currentThreadId = 'thread-1';
    const result = translateCodexNotification(
      { method: 'item/started', params: { item: { id: 'x', type: 'plan' } } },
      state
    );
    expect(result?.hookEventName).toBe('ItemStart:plan');
  });
});

describe('codexAdapter subscription glue', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-codex-adapter-'));
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

  it('persists a thread/started → turn/started → item/started → item/completed → turn/completed flow', () => {
    const emitter = new MockEmitter();
    const adapter = attachCodexAdapter(emitter);

    emitter.emit('thread/started', { thread: { id: 'thread-flow', status: 'ready' } });
    emitter.emit('turn/started', { turn: { id: 't-1' } });
    emitter.emit('item/started', { item: { id: 'i-1', type: 'commandExecution' } });
    emitter.emit('item/completed', { item: { id: 'i-1', type: 'commandExecution' } });
    emitter.emit('turn/completed', { turn: { id: 't-1', status: 'completed' } });

    expect(adapter.persistedCount).toBe(5);
    const rows = listCliHookEventsForSession('thread-flow');
    expect(rows.map((r) => r.hook_event_name)).toEqual([
      'Stop', 'PostToolUse', 'PreToolUse', 'UserPromptSubmit', 'SessionStart'
    ]);
  });

  it('drops item/agentMessage/delta notifications without persisting', () => {
    const emitter = new MockEmitter();
    const adapter = attachCodexAdapter(emitter);
    emitter.emit('thread/started', { thread: { id: 'thread-noise', status: 'ready' } });
    for (let i = 0; i < 100; i++) {
      emitter.emit('item/agentMessage/delta', { itemId: 'm', delta: `chunk ${i}` });
    }
    expect(adapter.persistedCount).toBe(1); // only SessionStart
    expect(adapter.droppedCount).toBe(100);
    expect(listCliHookEventsForSession('thread-noise')).toHaveLength(1);
  });
});
