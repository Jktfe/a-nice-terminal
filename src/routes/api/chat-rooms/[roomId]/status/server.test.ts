import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  upsertTerminal,
  markPaneVerified,
  markPaneStale
} from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-status-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

async function callGet(roomId: string, query: string = ''): Promise<Response> {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/status${query}`);
  const event = { request: new Request(url), params: { roomId }, url } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw thrown;
  }
}

describe('GET /api/chat-rooms/:roomId/status', () => {
  it('returns 404 when the room does not exist', async () => {
    const response = await callGet('does-not-exist');
    expect(response.status).toBe(404);
  });

  it('returns an empty members array for a room with no memberships', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.roomId).toBe(room.id);
    expect(payload.members).toEqual([]);
  });

  it('surfaces verified pane_status for a member whose terminal is at a ready prompt', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 1001, pid_start: 'ps1', name: 'term-a' });
    addMembership({ room_id: room.id, handle: '@a', terminal_id: terminal.id });
    markPaneVerified(terminal.id);

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.members).toHaveLength(1);
    expect(payload.members[0].handle).toBe('@a');
    expect(payload.members[0].terminal_id).toBe(terminal.id);
    expect(payload.members[0].pane_status).toBe('verified');
    expect(payload.members[0].pane_stale_since).toBeNull();
    expect(typeof payload.members[0].updated_at).toBe('number');
  });

  it('surfaces stale pane_status with pane_stale_since for a stale terminal', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 1002, pid_start: 'ps2', name: 'term-b' });
    addMembership({ room_id: room.id, handle: '@b', terminal_id: terminal.id });
    markPaneStale(terminal.id);

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.members).toHaveLength(1);
    expect(payload.members[0].pane_status).toBe('stale');
    expect(typeof payload.members[0].pane_stale_since).toBe('number');
  });

  it('returns unknown pane_status for a freshly registered terminal that has not been verified yet', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 1003, pid_start: 'ps3', name: 'term-c' });
    addMembership({ room_id: room.id, handle: '@c', terminal_id: terminal.id });

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.members[0].pane_status).toBe('unknown');
    expect(payload.members[0].pane_stale_since).toBeNull();
  });

  it('lists multiple members each with their own pane_status in membership-add order', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const t1 = upsertTerminal({ pid: 2001, pid_start: 'p1', name: 't1' });
    const t2 = upsertTerminal({ pid: 2002, pid_start: 'p2', name: 't2' });
    const t3 = upsertTerminal({ pid: 2003, pid_start: 'p3', name: 't3' });
    addMembership({ room_id: room.id, handle: '@first', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@second', terminal_id: t2.id });
    addMembership({ room_id: room.id, handle: '@third', terminal_id: t3.id });
    markPaneVerified(t1.id);
    markPaneStale(t2.id);
    // t3 stays unknown

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.members.map((m: { handle: string }) => m.handle)).toEqual(['@first', '@second', '@third']);
    expect(payload.members.map((m: { pane_status: string }) => m.pane_status)).toEqual(['verified', 'stale', 'unknown']);
  });

  it('M3.4a-v2 T3c: ?rich=1 ADDS agent_status fields per member', async () => {
    const { setAgentStatus } = await import('$lib/server/agentStatusStore');
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const t1 = upsertTerminal({ pid: 7001, pid_start: 'r1', name: 'rich-1' });
    const t2 = upsertTerminal({ pid: 7002, pid_start: 'r2', name: 'rich-2' });
    addMembership({ room_id: room.id, handle: '@rich-a', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@rich-b', terminal_id: t2.id });
    setAgentStatus({ terminalId: t1.id, newStatus: 'thinking', source: 'fingerprint' });
    setAgentStatus({ terminalId: t2.id, newStatus: 'working', source: 'hook' });

    const response = await callGet(room.id, '?rich=1');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.members).toHaveLength(2);
    expect(payload.members[0].agent_status).toBe('thinking');
    expect(payload.members[0].agent_status_source).toBe('fingerprint');
    expect(typeof payload.members[0].agent_status_at_ms).toBe('number');
    expect(payload.members[1].agent_status).toBe('working');
    expect(payload.members[1].agent_status_source).toBe('hook');
  });

  it('M3.4a-v2 T3c: rich=absent response is byte-compatible with v1 (no agent_status fields)', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 7003, pid_start: 'r3', name: 'no-rich' });
    addMembership({ room_id: room.id, handle: '@plain', terminal_id: terminal.id });

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(Object.keys(payload.members[0])).toEqual(['handle', 'terminal_id', 'pane_status', 'pane_stale_since', 'updated_at']);
    expect((payload.members[0] as Record<string, unknown>).agent_status).toBeUndefined();
  });

  it('M3.4a-v2 T3c: rich=1 with terminal that has no agent_status row falls back to idle/default/0', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 7004, pid_start: 'r4', name: 'no-agent-row' });
    addMembership({ room_id: room.id, handle: '@fresh', terminal_id: terminal.id });

    const response = await callGet(room.id, '?rich=1');
    const payload = await response.json();
    expect(payload.members[0].agent_status).toBe('idle');
    expect(payload.members[0].agent_status_source).toBe('default');
    expect(payload.members[0].agent_status_at_ms).toBe(0);
  });

  it('M3.4a-v2 T3c: rich=1 expires stale volatile working statuses', async () => {
    const { setAgentStatus } = await import('$lib/server/agentStatusStore');
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 7005, pid_start: 'r5', name: 'stale-active' });
    addMembership({ room_id: room.id, handle: '@stale', terminal_id: terminal.id });
    setAgentStatus({
      terminalId: terminal.id,
      newStatus: 'working',
      source: 'ant-activity',
      nowMs: Date.now() - 120_000
    });

    const response = await callGet(room.id, '?rich=1');
    const payload = await response.json();
    expect(payload.members[0].agent_status).toBe('idle');
    expect(payload.members[0].agent_status_source).toBe('default');
    expect(payload.members[0].agent_status_at_ms).toBe(0);
  });
});
