import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import { resetChatRoomStoreForTests, createChatRoom, inviteAgentToRoom } from '$lib/server/chatRoomStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { setAgentStatus } from '$lib/server/agentStatusStore';
import { postMessage } from '$lib/server/chatMessageStore';
import { digestForHandle } from '$lib/server/availabilityDigestStore';

let tmpDir: string;
const prevEnv = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-availability-digest-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevEnv;
});

describe('digestForHandle', () => {
  it('returns empty bundle when handle has no terminal binding', () => {
    const digest = digestForHandle({ handle: '@nobody' });
    expect(digest.terminalId).toBeNull();
    expect(digest.windowStartMs).toBeNull();
    expect(digest.missed).toEqual([]);
  });

  it('returns empty bundle when terminal exists but has no status history', () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const t = upsertTerminal({ pid: 100, pid_start: 'p1', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: t.id });
    const digest = digestForHandle({ handle: '@agent' });
    expect(digest.terminalId).toBe(t.id);
    expect(digest.windowStartMs).toBeNull();
    expect(digest.missed).toEqual([]);
  });

  it('captures bare-mention messages missed during a closed idle window', () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const t = upsertTerminal({ pid: 100, pid_start: 'p1', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: t.id });
    // Window straddles 'now' so postMessage's real-time `postedAt`
    // lands inside (the store synthesises postedAt at insert time).
    const idleStart = Date.now() - 60_000;
    const wakeUp = Date.now() + 60_000;
    setAgentStatus({ terminalId: t.id, newStatus: 'idle', source: 'ant-activity', nowMs: idleStart });
    // Messages posted during the idle window:
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello @agent are you there?' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'no mention here for you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'reminder @agent please look' });
    setAgentStatus({ terminalId: t.id, newStatus: 'working', source: 'ant-activity', nowMs: wakeUp });

    const digest = digestForHandle({ handle: '@agent', nowMs: wakeUp + 1000 });
    expect(digest.stillIdle).toBe(false);
    expect(digest.windowStartMs).toBe(idleStart);
    expect(digest.windowEndMs).toBe(wakeUp);
    expect(digest.missed).toHaveLength(2);
    expect(digest.missed[0].bodyPreview).toContain('@agent');
    expect(digest.missed[1].bodyPreview).toContain('@agent');
  });

  it('marks stillIdle=true and uses now as window end when terminal currently idle', () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const t = upsertTerminal({ pid: 100, pid_start: 'p1', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: t.id });
    const idleStart = Date.now() - 60_000;
    setAgentStatus({ terminalId: t.id, newStatus: 'idle', source: 'ant-activity', nowMs: idleStart });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'ping @agent' });

    const now = Date.now() + 60_000;
    const digest = digestForHandle({ handle: '@agent', nowMs: now });
    expect(digest.stillIdle).toBe(true);
    expect(digest.windowStartMs).toBe(idleStart);
    expect(digest.windowEndMs).toBe(now);
    expect(digest.missed).toHaveLength(1);
  });

  it('excludes bracketed mentions from the digest (matches strict-bare fanout contract)', () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const t = upsertTerminal({ pid: 100, pid_start: 'p1', name: 'agent-term' });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: t.id });
    // Window straddles 'now' so postMessage's real-time `postedAt`
    // lands inside (the store synthesises postedAt at insert time).
    const idleStart = Date.now() - 60_000;
    const wakeUp = Date.now() + 60_000;
    setAgentStatus({ terminalId: t.id, newStatus: 'idle', source: 'ant-activity', nowMs: idleStart });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'bracketed [@agent] should not count' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'bare @agent should count' });
    setAgentStatus({ terminalId: t.id, newStatus: 'working', source: 'ant-activity', nowMs: wakeUp });

    const digest = digestForHandle({ handle: '@agent', nowMs: wakeUp + 1 });
    expect(digest.missed).toHaveLength(1);
    expect(digest.missed[0].bodyPreview).toBe('bare @agent should count');
  });
});
