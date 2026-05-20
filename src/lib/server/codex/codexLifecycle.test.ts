/**
 * codexLifecycle tests — CLI-HOOK-BRIDGE Phase 2 spawn-glue (2026-05-15).
 *
 * Exercises the bridge against a mock ChildProcess (EventEmitter + Writable
 * + Readable shims) so no real codex binary is needed. The real `spawn`
 * path is exercised by live verify if/when the user has codex installed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { attachCodexBridgeToChild, type CodexChildShape } from './codexLifecycle';
import {
  listCliHookEventsForSession,
  resetCliHookEventsStoreForTests
} from '../cliHookEventsStore';
import { resetIdentityDbForTests } from '../db';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;

class MockChild extends EventEmitter implements CodexChildShape {
  stdout = new PassThrough();
  stdin = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }

  /** Test helper — write a JSON object to stdout as one NDJSON line. */
  pushMessage(msg: Record<string, unknown>): void {
    this.stdout.write(JSON.stringify(msg) + '\n');
  }

  /** Test helper — read everything the bridge has written to stdin. */
  readStdinWrites(): string[] {
    const chunks: Buffer[] = [];
    let chunk: Buffer | null = this.stdin.read();
    while (chunk !== null) {
      chunks.push(chunk);
      chunk = this.stdin.read();
    }
    return Buffer.concat(chunks).toString('utf8').split('\n').filter((s) => s.length > 0);
  }
}

describe('codexLifecycle / attachCodexBridgeToChild', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-codex-lifecycle-'));
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

  it('writes valid JSON-RPC requests to stdin and resolves on matching responses', async () => {
    const child = new MockChild();
    const bridge = attachCodexBridgeToChild(child);

    const responsePromise = bridge.sendRequest<{ ok: boolean }>('echo', { x: 1 });
    // Drain stdin to see what got written
    await new Promise((r) => setImmediate(r));
    const written = child.readStdinWrites();
    expect(written).toHaveLength(1);
    const sent = JSON.parse(written[0]);
    expect(sent.jsonrpc).toBe('2.0');
    expect(sent.method).toBe('echo');
    expect(sent.params).toEqual({ x: 1 });
    expect(sent.id).toBe(1);

    // Simulate codex responding to request id=1
    child.pushMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    await new Promise((r) => setImmediate(r));

    expect(await responsePromise).toEqual({ ok: true });
    bridge.dispose();
  });

  it('routes thread/started → SessionStart with threadId as session_id', async () => {
    const child = new MockChild();
    const bridge = attachCodexBridgeToChild(child);
    child.pushMessage({
      jsonrpc: '2.0',
      method: 'thread/started',
      params: { thread: { id: 'thread-bridge-abc', status: 'ready' } }
    });
    await new Promise((r) => setImmediate(r));
    expect(bridge.state.currentThreadId).toBe('thread-bridge-abc');
    const rows = listCliHookEventsForSession('thread-bridge-abc');
    expect(rows).toHaveLength(1);
    expect(rows[0].hook_event_name).toBe('SessionStart');
    expect(rows[0].source_cli).toBe('codex');
    bridge.dispose();
  });

  it('routes a full thread/turn/item flow to the right hook events', async () => {
    const child = new MockChild();
    const bridge = attachCodexBridgeToChild(child);
    child.pushMessage({ jsonrpc: '2.0', method: 'thread/started', params: { thread: { id: 'thread-flow' } } });
    child.pushMessage({ jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: 't1' } } });
    child.pushMessage({ jsonrpc: '2.0', method: 'item/started', params: { item: { id: 'i1', type: 'commandExecution' } } });
    child.pushMessage({ jsonrpc: '2.0', method: 'item/completed', params: { item: { id: 'i1', type: 'commandExecution' } } });
    child.pushMessage({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: 't1', status: 'completed' } } });
    await new Promise((r) => setImmediate(r));

    const rows = listCliHookEventsForSession('thread-flow');
    expect(rows.map((r) => r.hook_event_name)).toEqual([
      'Stop', 'PostToolUse', 'PreToolUse', 'UserPromptSubmit', 'SessionStart'
    ]);
    expect(rows.find((r) => r.hook_event_name === 'PreToolUse')?.tool_name).toBe('Bash');
    bridge.dispose();
  });

  it('initialize() sends initialize request + initialized notification on response', async () => {
    const child = new MockChild();
    const bridge = attachCodexBridgeToChild(child);

    const initPromise = bridge.initialize();
    await new Promise((r) => setImmediate(r));

    const initWrite = JSON.parse(child.readStdinWrites()[0]);
    expect(initWrite.method).toBe('initialize');
    expect(initWrite.params.clientInfo.name).toBe('ant');

    child.pushMessage({
      jsonrpc: '2.0',
      id: initWrite.id,
      result: { userAgent: 'codex/0.131', codexHome: '/tmp/codex' }
    });
    await new Promise((r) => setImmediate(r));

    expect(await initPromise).toMatchObject({ userAgent: 'codex/0.131' });

    // The follow-on `initialized` notification should be on stdin too.
    const allWrites = child.readStdinWrites().map((s) => JSON.parse(s));
    expect(allWrites.some((m) => m.method === 'initialized' && m.id === undefined)).toBe(true);
    bridge.dispose();
  });

  it('child exit rejects pending requests and stops persisting', async () => {
    const child = new MockChild();
    const bridge = attachCodexBridgeToChild(child);
    const pending = bridge.sendRequest('thread/start');
    child.emit('exit', 0, null);
    await expect(pending).rejects.toThrow(/codex child exited/);
  });

  it('dispose() kills the child and rejects new requests', async () => {
    const child = new MockChild();
    const bridge = attachCodexBridgeToChild(child);
    bridge.dispose();
    expect(child.killed).toBe(true);
    await expect(bridge.sendRequest('whatever')).rejects.toThrow(/disposed/);
  });

  it('drops item/agentMessage/delta notifications (Phase 2 noise filter applies)', async () => {
    const child = new MockChild();
    const bridge = attachCodexBridgeToChild(child);
    child.pushMessage({ jsonrpc: '2.0', method: 'thread/started', params: { thread: { id: 'thread-noise' } } });
    for (let i = 0; i < 50; i++) {
      child.pushMessage({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { itemId: 'm', delta: `chunk ${i}` } });
    }
    await new Promise((r) => setImmediate(r));
    const rows = listCliHookEventsForSession('thread-noise');
    expect(rows).toHaveLength(1); // only SessionStart
    expect(bridge.droppedCount).toBe(50);
    bridge.dispose();
  });
});
