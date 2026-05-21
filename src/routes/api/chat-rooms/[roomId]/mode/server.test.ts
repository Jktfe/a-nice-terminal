import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PUT } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { setRoomMode, listModeHistory } from '$lib/server/roomModesStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-mode-route-'));
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
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/mode`);
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

async function callPut(roomId: string, body: object): Promise<Response> {
  const request = new Request(`http://localhost/api/chat-rooms/${roomId}/mode`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const event = { request, params: { roomId } } as unknown as Parameters<typeof PUT>[0];
  try {
    return (await PUT(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw thrown;
  }
}

function setupRoomWithMember(handle = '@speaker'): { roomId: string; pidChain: Array<{ pid: number; pid_start: string }> } {
  const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
  const terminal = upsertTerminal({ pid: 7777, pid_start: 'ps7', name: `term-${handle}` });
  addMembership({ room_id: room.id, handle, terminal_id: terminal.id });
  return { roomId: room.id, pidChain: [{ pid: 7777, pid_start: 'ps7' }] };
}

describe('GET /api/chat-rooms/:roomId/mode', () => {
  it('returns brainstorm + null set fields when no row exists', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ roomId: room.id, mode: 'brainstorm', set_by: null, set_at: null });
  });

  it('returns the stored mode + set_by + set_at when a row exists', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    setRoomMode({ roomId: room.id, mode: 'heads-down', set_by: '@a' });
    const payload = await (await callGet(room.id)).json();
    expect(payload.mode).toBe('heads-down');
    expect(payload.set_by).toBe('@a');
    expect(typeof payload.set_at).toBe('number');
  });

  it('404 when the room does not exist', async () => {
    expect((await callGet('phantom')).status).toBe(404);
  });
});

describe('PUT /api/chat-rooms/:roomId/mode — success path', () => {
  it('200 + persists each of the 3 modes', async () => {
    const { roomId, pidChain } = setupRoomWithMember();
    for (const mode of ['brainstorm', 'heads-down', 'closed'] as const) {
      const response = await callPut(roomId, { mode, pidChain });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.mode).toBe(mode);
      expect(payload.set_by).toBe('@speaker');
    }
  });

  it('appends one history row per successful PUT', async () => {
    const { roomId, pidChain } = setupRoomWithMember();
    await callPut(roomId, { mode: 'brainstorm', pidChain });
    await callPut(roomId, { mode: 'heads-down', pidChain });
    await callPut(roomId, { mode: 'closed', pidChain });
    expect(listModeHistory(roomId).length).toBe(3);
  });
});

describe('PUT /api/chat-rooms/:roomId/mode — rejection paths', () => {
  it('400 on missing body', async () => {
    const { roomId, pidChain: _p } = setupRoomWithMember();
    const request = new Request(`http://localhost/api/chat-rooms/${roomId}/mode`, { method: 'PUT' });
    const event = { request, params: { roomId } } as unknown as Parameters<typeof PUT>[0];
    let status = 0;
    try { status = ((await PUT(event)) as Response).status; }
    catch (t) { status = (t as { status: number }).status; }
    expect(status).toBe(400);
  });

  it('400 on invalid mode value', async () => {
    const { roomId, pidChain } = setupRoomWithMember();
    const response = await callPut(roomId, { mode: 'mute', pidChain });
    expect(response.status).toBe(400);
  });

  it('400 when pidChain is missing', async () => {
    const { roomId } = setupRoomWithMember();
    const response = await callPut(roomId, { mode: 'closed' });
    expect(response.status).toBe(400);
  });

  it('403 when pidChain does not resolve to a member of this room', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callPut(room.id, {
      mode: 'closed',
      pidChain: [{ pid: 8888, pid_start: 'unknown' }]
    });
    expect(response.status).toBe(403);
  });

  it('404 when the room does not exist', async () => {
    const response = await callPut('phantom', {
      mode: 'closed',
      pidChain: [{ pid: 1, pid_start: 'ps' }]
    });
    expect(response.status).toBe(404);
  });
});
