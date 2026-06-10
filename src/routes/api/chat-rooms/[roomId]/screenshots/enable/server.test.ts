import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUT } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import {
  isSharedFolderEnabled,
  resetScreenshotIndexStoreForTests
} from '$lib/server/screenshotIndexStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-screenshots-enable-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetScreenshotIndexStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

async function callPut(roomId: string, body: object): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/screenshots/enable`;
  const request = new Request(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const event = { request, params: { roomId } } as unknown as Parameters<typeof PUT>[0];
  try {
    return (await PUT(event)) as Response;
  } catch (t) {
    if (t instanceof Response) return t;
    const f = t as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') {
      return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    }
    throw t;
  }
}

function setupRoomWithMemberCaller(name: string, callerPid: number) {
  const room = createChatRoom({ name, whoCreatedIt: '@you' });
  const term = upsertTerminal({ pid: callerPid, pid_start: `ps${callerPid}`, name: '@caller' });
  addMembership({ room_id: room.id, handle: '@caller', terminal_id: term.id });
  return { room, pidChain: [{ pid: callerPid, pid_start: `ps${callerPid}` }] };
}

describe('PUT /api/chat-rooms/:roomId/screenshots/enable', () => {
  it('200 + { enabled: true } toggles flag ON', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r1', 7001);
    const response = await callPut(room.id, { enabled: true, pidChain });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.enabled).toBe(true);
    expect(isSharedFolderEnabled(room.id)).toBe(true);
  });

  it('200 + { enabled: false } toggles flag OFF', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r2', 7002);
    await callPut(room.id, { enabled: true, pidChain });
    const response = await callPut(room.id, { enabled: false, pidChain });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.enabled).toBe(false);
    expect(isSharedFolderEnabled(room.id)).toBe(false);
  });

  it('404 on unknown room', async () => {
    const response = await callPut('phantom', { enabled: true, pidChain: [{ pid: 1, pid_start: 'x' }] });
    expect(response.status).toBe(404);
  });

  it('400 when enabled is missing', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r3', 7003);
    const response = await callPut(room.id, { pidChain } as object);
    expect(response.status).toBe(400);
  });

  it('400 when enabled is not a boolean', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r4', 7004);
    const response = await callPut(room.id, { enabled: 'yes', pidChain });
    expect(response.status).toBe(400);
  });

  it('403 when pidChain identity does not resolve to a room member', async () => {
    const { room } = setupRoomWithMemberCaller('r5', 7005);
    const response = await callPut(room.id, {
      enabled: true,
      pidChain: [{ pid: 99999, pid_start: 'unknown' }]
    });
    expect(response.status).toBe(403);
  });

  it('400 when body is empty / not JSON', async () => {
    const { room } = setupRoomWithMemberCaller('r6', 7006);
    const url = `http://localhost/api/chat-rooms/${room.id}/screenshots/enable`;
    const request = new Request(url, { method: 'PUT', body: '' });
    const event = { request, params: { roomId: room.id } } as unknown as Parameters<typeof PUT>[0];
    let response: Response;
    try { response = (await PUT(event)) as Response; }
    catch (t) {
      response = t instanceof Response
        ? t
        : new Response(JSON.stringify((t as { body?: object }).body ?? {}), {
            status: (t as { status?: number }).status ?? 500
          });
    }
    expect(response.status).toBe(400);
  });
});
