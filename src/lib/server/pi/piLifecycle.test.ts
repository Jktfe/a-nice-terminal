/**
 * piLifecycle tests — CLI-HOOK-BRIDGE Phase 3 spawn-glue (2026-05-15).
 *
 * Exercises the bridge against a mock pi child (EventEmitter + Writable/
 * Readable shims). No real pi binary needed for these tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { attachPiBridgeToChild, type PiChildShape } from './piLifecycle';
import {
  listCliHookEventsForSession,
  resetCliHookEventsStoreForTests
} from '../cliHookEventsStore';
import { resetIdentityDbForTests } from '../db';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;

class MockPiChild extends EventEmitter implements PiChildShape {
  stdout = new PassThrough();
  stdin = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    setImmediate(() => this.emit('exit', 0, null));
    return true;
  }

  pushLine(line: string): void {
    this.stdout.write(line + '\n');
  }

  pushEvent(event: Record<string, unknown>): void {
    this.pushLine(JSON.stringify(event));
  }

  pushResponse(id: string, result: unknown): void {
    this.pushLine(JSON.stringify({ id, result }));
  }

  pushError(id: string, message: string): void {
    this.pushLine(JSON.stringify({ id, error: { message } }));
  }

  readStdinWrites(): Array<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let chunk: Buffer | null = this.stdin.read();
    while (chunk !== null) {
      chunks.push(chunk);
      chunk = this.stdin.read();
    }
    return Buffer.concat(chunks)
      .toString('utf8')
      .split('\n')
      .filter((s) => s.length > 0)
      .map((s) => JSON.parse(s));
  }
}

async function nextTick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe('piLifecycle / attachPiBridgeToChild', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-pi-lifecycle-'));
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

  it('on attach, sends a get_state RPC to fetch sessionId', async () => {
    const child = new MockPiChild();
    const bridge = attachPiBridgeToChild(child);
    await nextTick();

    const sent = child.readStdinWrites();
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('get_state');
    expect(typeof sent[0].id).toBe('string');

    // Respond:
    const getStateId = sent[0].id as string;
    child.pushResponse(getStateId, { sessionId: 'pi-sess-abc', sessionName: 'sample' });
    await nextTick();
    expect(bridge.state.currentSessionId).toBe('pi-sess-abc');
  });

  it('events received BEFORE sessionId resolves are dropped (no sess_id = no persist)', async () => {
    const child = new MockPiChild();
    const bridge = attachPiBridgeToChild(child);
    // Push an event BEFORE responding to get_state — translator returns null
    child.pushEvent({ type: 'agent_start' });
    await nextTick();
    expect(bridge.persistedCount).toBe(0);
    expect(bridge.droppedCount).toBe(1);
  });

  it('events AFTER sessionId resolution are persisted under that sessionId', async () => {
    const child = new MockPiChild();
    const bridge = attachPiBridgeToChild(child);
    await nextTick();
    const getStateId = child.readStdinWrites()[0].id as string;
    child.pushResponse(getStateId, { sessionId: 'pi-sess-flow' });
    await nextTick();

    child.pushEvent({ type: 'agent_start' });
    child.pushEvent({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 't1', args: { command: 'ls' } });
    child.pushEvent({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: 'ok', isError: false });
    child.pushEvent({ type: 'agent_end' });
    await nextTick();

    const rows = listCliHookEventsForSession('pi-sess-flow');
    expect(rows.map((r) => r.hook_event_name).reverse()).toEqual([
      'SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'
    ]);
  });

  it('sendCommand resolves on matching response by id', async () => {
    const child = new MockPiChild();
    const bridge = attachPiBridgeToChild(child);
    await nextTick();
    child.readStdinWrites(); // drain the get_state

    const promise = bridge.sendCommand<{ ok: boolean }>({ type: 'compact' });
    await nextTick();
    const sent = child.readStdinWrites();
    const sentCompact = sent.find((m) => m.type === 'compact')!;
    expect(sentCompact).toBeDefined();
    expect(typeof sentCompact.id).toBe('string');
    child.pushResponse(sentCompact.id as string, { ok: true });
    expect(await promise).toEqual({ ok: true });
  });

  it('sendCommand rejects on RPC error response', async () => {
    const child = new MockPiChild();
    const bridge = attachPiBridgeToChild(child);
    await nextTick();
    child.readStdinWrites();

    const promise = bridge.sendCommand({ type: 'fork', entryId: 'nope' });
    await nextTick();
    const sent = child.readStdinWrites();
    const forkSent = sent.find((m) => m.type === 'fork')!;
    child.pushError(forkSent.id as string, 'no such entry');
    await expect(promise).rejects.toThrow(/no such entry/);
  });

  it('child exit rejects pending requests', async () => {
    const child = new MockPiChild();
    const bridge = attachPiBridgeToChild(child);
    await nextTick();
    const pending = bridge.sendCommand({ type: 'prompt', message: 'hi' });
    child.emit('exit', 0, null);
    await expect(pending).rejects.toThrow(/pi child exited/);
  });

  it('dispose() sends abort + SIGTERMs the child', async () => {
    const child = new MockPiChild();
    const bridge = attachPiBridgeToChild(child);
    await nextTick();
    child.readStdinWrites();

    const disposed = bridge.dispose();
    // The kill() above schedules an exit via setImmediate; let it fire.
    await disposed;
    expect(child.killed).toBe(true);
  });

  it('persists compaction events under the resolved sessionId', async () => {
    const child = new MockPiChild();
    const bridge = attachPiBridgeToChild(child);
    await nextTick();
    const getStateId = child.readStdinWrites()[0].id as string;
    child.pushResponse(getStateId, { sessionId: 'pi-comp' });
    await nextTick();

    child.pushEvent({ type: 'compaction_start', reason: 'threshold' });
    child.pushEvent({ type: 'compaction_end', aborted: false, willRetry: false });
    await nextTick();
    const rows = listCliHookEventsForSession('pi-comp');
    expect(rows.map((r) => r.hook_event_name)).toEqual(['PostCompact', 'PreCompact']);
  });
});
