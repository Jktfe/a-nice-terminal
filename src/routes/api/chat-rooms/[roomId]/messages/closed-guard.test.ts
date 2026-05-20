import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetChatMessageStoreForTests, listMessagesInRoom } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { setRoomMode } from '$lib/server/roomModesStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';

// M3.6a-v1 T1: success-path POSTs supply server-resolvable identity so they
// don't trip the deprecation warning gate. Closed-mode 409 / invalid-body 400
// tests short-circuit BEFORE auth resolution, so they intentionally don't.
function registerCallerInRoom(roomId: string, pid: number) {
  const terminal = upsertTerminal({ pid, pid_start: `pst${pid}`, name: '@guard-caller' });
  addMembership({ room_id: roomId, handle: '@guard-caller', terminal_id: terminal.id });
  return { authorHandle: '@guard-caller', pidChain: [{ pid, pid_start: `pst${pid}` }] };
}

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-closed-guard-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

async function callPost(roomId: string, body: object): Promise<Response> {
  const request = new Request(`http://localhost/api/chat-rooms/${roomId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const event = { request, params: { roomId } } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

describe('POST /api/chat-rooms/:roomId/messages closed-mode guard', () => {
  it('returns 409 with reopen-instruction message when room mode is closed', async () => {
    const room = createChatRoom({ name: 'frozen', whoCreatedIt: '@you' });
    setRoomMode({ roomId: room.id, mode: 'closed', set_by: '@admin' });
    const response = await callPost(room.id, { body: 'should be refused' });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(typeof payload.message).toBe('string');
    expect(payload.message).toMatch(/Room is closed/);
    expect(payload.message).toMatch(/--set brainstorm/);
  });

  it('does not store the message when closed (no fanout side-effect)', async () => {
    const room = createChatRoom({ name: 'frozen2', whoCreatedIt: '@you' });
    setRoomMode({ roomId: room.id, mode: 'closed', set_by: '@admin' });
    await callPost(room.id, { body: 'discarded' });
    expect(listMessagesInRoom(room.id)).toEqual([]);
  });

  it('returns 201 normally when mode is brainstorm (default)', async () => {
    const room = createChatRoom({ name: 'open1', whoCreatedIt: '@you' });
    const caller = registerCallerInRoom(room.id, 7101);
    const response = await callPost(room.id, { body: 'hello world', ...caller });
    expect(response.status).toBe(201);
  });

  it('returns 201 normally when mode is heads-down (M3.b.4 ships routing in M3.b.5)', async () => {
    const room = createChatRoom({ name: 'open2', whoCreatedIt: '@you' });
    setRoomMode({ roomId: room.id, mode: 'heads-down', set_by: '@admin' });
    const caller = registerCallerInRoom(room.id, 7102);
    const response = await callPost(room.id, { body: 'heads-down still stores', ...caller });
    expect(response.status).toBe(201);
  });

  it('400 on invalid body still takes precedence over closed-check', async () => {
    const room = createChatRoom({ name: 'order1', whoCreatedIt: '@you' });
    setRoomMode({ roomId: room.id, mode: 'closed', set_by: '@admin' });
    const request = new Request(`http://localhost/api/chat-rooms/${room.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const event = { request, params: { roomId: room.id } } as unknown as Parameters<typeof POST>[0];
    let status = 0;
    try {
      const response = (await POST(event)) as Response;
      status = response.status;
    } catch (thrown) {
      status = (thrown as { status: number }).status;
    }
    expect(status).toBe(400);
  });

  it('reopening via setRoomMode allows new POSTs again', async () => {
    const room = createChatRoom({ name: 'reopen', whoCreatedIt: '@you' });
    setRoomMode({ roomId: room.id, mode: 'closed', set_by: '@admin' });
    expect((await callPost(room.id, { body: 'first' })).status).toBe(409);
    setRoomMode({ roomId: room.id, mode: 'brainstorm', set_by: '@admin' });
    const caller = registerCallerInRoom(room.id, 7103);
    expect((await callPost(room.id, { body: 'second', ...caller })).status).toBe(201);
  });
});
