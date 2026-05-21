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
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-audit-route-'));
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

async function callGet(roomId: string): Promise<Response> {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/audit`);
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

describe('GET /api/chat-rooms/:roomId/audit', () => {
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

  it('surfaces a single member with handle + terminal_id + terminal_name + joined_at', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 4001, pid_start: 'p1', name: 'term-named' });
    addMembership({ room_id: room.id, handle: '@only', terminal_id: terminal.id });

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(payload.members).toHaveLength(1);
    expect(payload.members[0].handle).toBe('@only');
    expect(payload.members[0].terminal_id).toBe(terminal.id);
    expect(payload.members[0].terminal_name).toBe('term-named');
    expect(typeof payload.members[0].joined_at).toBe('number');
    expect(payload.members[0].agent_kind).toBeNull();
  });

  it('lists multiple members preserving membership-add order via created_at', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const t1 = upsertTerminal({ pid: 4101, pid_start: 'a', name: 'first' });
    const t2 = upsertTerminal({ pid: 4102, pid_start: 'b', name: 'second' });
    const t3 = upsertTerminal({ pid: 4103, pid_start: 'c', name: 'third' });
    addMembership({ room_id: room.id, handle: '@first', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@second', terminal_id: t2.id });
    addMembership({ room_id: room.id, handle: '@third', terminal_id: t3.id });

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(payload.members.map((m: { handle: string }) => m.handle)).toEqual(['@first', '@second', '@third']);
    expect(payload.members.map((m: { terminal_name: string }) => m.terminal_name)).toEqual(['first', 'second', 'third']);
  });

  it('preserves the membership-row created_at as joined_at in the response (auditability invariant)', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 4301, pid_start: 'jp', name: 'joined-at-check' });
    addMembership({ room_id: room.id, handle: '@joined', terminal_id: terminal.id });

    const beforeReadTimestamp = Math.floor(Date.now() / 1000);
    const response = await callGet(room.id);
    const payload = await response.json();
    const joinedAt = payload.members[0].joined_at;
    expect(typeof joinedAt).toBe('number');
    expect(joinedAt).toBeLessThanOrEqual(beforeReadTimestamp);
    expect(joinedAt).toBeGreaterThan(beforeReadTimestamp - 60);
  });

  it('does not expose last_activity_at in v1 — schema explicitly excludes it (punted to v2)', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 4201, pid_start: 'p', name: 'term-act' });
    addMembership({ room_id: room.id, handle: '@active', terminal_id: terminal.id });

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(Object.keys(payload.members[0])).not.toContain('last_activity_at');
  });
});
