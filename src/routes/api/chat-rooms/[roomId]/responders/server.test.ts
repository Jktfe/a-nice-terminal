import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PUT, POST, PATCH, DELETE } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal, markPaneVerified } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-resp-route-'));
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

type Verb = 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE';
const HANDLERS = { GET, PUT, POST, PATCH, DELETE };

async function call(verb: Verb, roomId: string, body?: object): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/responders`;
  const init: RequestInit = { method: verb };
  if (body) { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body); }
  const request = new Request(url, init);
  const event = { request, params: { roomId }, url: new URL(url) } as unknown as Parameters<typeof GET>[0];
  try {
    return (await HANDLERS[verb](event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw thrown;
  }
}

function setupRoomWithMembers(handles: string[]) {
  const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
  const memberTerminal = upsertTerminal({ pid: 1111, pid_start: 'pm', name: 'caller-term' });
  addMembership({ room_id: room.id, handle: '@caller', terminal_id: memberTerminal.id });
  const handleTerminals: Record<string, string> = {};
  for (let position = 0; position < handles.length; position += 1) {
    const handle = handles[position];
    const terminal = upsertTerminal({ pid: 2000 + position, pid_start: `ph${position}`, name: `term-${handle}` });
    addMembership({ room_id: room.id, handle, terminal_id: terminal.id });
    handleTerminals[handle] = terminal.id;
  }
  return { roomId: room.id, pidChain: [{ pid: 1111, pid_start: 'pm' }], handleTerminals };
}

describe('GET /api/chat-rooms/:roomId/responders', () => {
  it('returns empty list for a fresh room', async () => {
    const { roomId } = setupRoomWithMembers([]);
    const payload = await (await call('GET', roomId)).json();
    expect(payload.roomId).toBe(roomId);
    expect(payload.responders).toEqual([]);
  });
  it('404 when room does not exist', async () => {
    expect((await call('GET', 'phantom')).status).toBe(404);
  });
});

describe('PUT — replace-all', () => {
  it('200 + lists 3 responders in given order with pane_status joined', async () => {
    const { roomId, pidChain, handleTerminals } = setupRoomWithMembers(['@a', '@b', '@c']);
    markPaneVerified(handleTerminals['@b']);
    const payload = await (await call('PUT', roomId, { handles: ['@a', '@b', '@c'], pidChain })).json();
    expect(payload.responders.map((r: { handle: string }) => r.handle)).toEqual(['@a', '@b', '@c']);
    const second = payload.responders.find((r: { handle: string }) => r.handle === '@b');
    expect(second.pane_status).toBe('verified');
  });
  it('403 when caller is not a member', async () => {
    const { roomId } = setupRoomWithMembers(['@a']);
    const response = await call('PUT', roomId, { handles: ['@a'], pidChain: [{ pid: 9999, pid_start: 'fake' }] });
    expect(response.status).toBe(403);
  });
  it('400 on missing pidChain / unknown handle / duplicate handle', async () => {
    const { roomId, pidChain } = setupRoomWithMembers(['@a']);
    expect((await call('PUT', roomId, { handles: ['@a'] })).status).toBe(400);
    expect((await call('PUT', roomId, { handles: ['@unknown'], pidChain })).status).toBe(400);
    expect((await call('PUT', roomId, { handles: ['@a', '@a'], pidChain })).status).toBe(400);
  });
});

describe('POST — insert', () => {
  it('appends when no `at` given', async () => {
    const { roomId, pidChain } = setupRoomWithMembers(['@a', '@b']);
    await call('PUT', roomId, { handles: ['@a'], pidChain });
    const payload = await (await call('POST', roomId, { handle: '@b', pidChain })).json();
    expect(payload.responders.map((r: { handle: string }) => r.handle)).toEqual(['@a', '@b']);
  });
  it('inserts at position when `at` given', async () => {
    const { roomId, pidChain } = setupRoomWithMembers(['@a', '@b', '@c']);
    await call('PUT', roomId, { handles: ['@a', '@b'], pidChain });
    const payload = await (await call('POST', roomId, { handle: '@c', at: 1, pidChain })).json();
    expect(payload.responders.map((r: { handle: string }) => r.handle)).toEqual(['@a', '@c', '@b']);
  });
});

describe('PATCH — move', () => {
  it('moves responder to new position', async () => {
    const { roomId, pidChain } = setupRoomWithMembers(['@a', '@b', '@c']);
    await call('PUT', roomId, { handles: ['@a', '@b', '@c'], pidChain });
    const payload = await (await call('PATCH', roomId, { handle: '@a', to: 2, pidChain })).json();
    expect(payload.responders.map((r: { handle: string }) => r.handle)).toEqual(['@b', '@c', '@a']);
  });
  it('404 when handle is not in the list', async () => {
    const { roomId, pidChain } = setupRoomWithMembers(['@a', '@b']);
    await call('PUT', roomId, { handles: ['@a'], pidChain });
    const response = await call('PATCH', roomId, { handle: '@b', to: 0, pidChain });
    expect(response.status).toBe(404);
  });
});

describe('DELETE — remove', () => {
  it('removes responder by handle via JSON body', async () => {
    const { roomId, pidChain } = setupRoomWithMembers(['@a', '@b']);
    await call('PUT', roomId, { handles: ['@a', '@b'], pidChain });
    const payload = await (await call('DELETE', roomId, { handle: '@a', pidChain })).json();
    expect(payload.responders.map((r: { handle: string }) => r.handle)).toEqual(['@b']);
  });
  it('404 when handle not in list', async () => {
    const { roomId, pidChain } = setupRoomWithMembers(['@a']);
    await call('PUT', roomId, { handles: [], pidChain });
    expect((await call('DELETE', roomId, { handle: '@a', pidChain })).status).toBe(404);
  });
  it('403 when caller is not a member (all 4 write verbs share gate)', async () => {
    const { roomId } = setupRoomWithMembers(['@a']);
    const response = await call('DELETE', roomId, { handle: '@a', pidChain: [{ pid: 9, pid_start: 'fake' }] });
    expect(response.status).toBe(403);
  });
});
