import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import {
  checkDedupAndReserve,
  enableSharedFolder,
  listScreenshotsForRoom,
  resetScreenshotIndexStoreForTests
} from '$lib/server/screenshotIndexStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-screenshots-prune-'));
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

async function callPost(roomId: string, sha: string, body: object): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/screenshots/${sha}/prune`;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const event = { request, params: { roomId, sha } } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (t) {
    if (t instanceof Response) return t;
    const f = t as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') {
      return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    }
    throw t;
  }
}

function setupRoomWithMemberCallerAndScreenshot(sha: string, callerPid: number) {
  const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
  const term = upsertTerminal({ pid: callerPid, pid_start: `ps${callerPid}`, name: '@caller' });
  addMembership({ room_id: room.id, handle: '@caller', terminal_id: term.id });
  enableSharedFolder(room.id, true);
  checkDedupAndReserve({ roomId: room.id, sha, takenBy: '@you', bytes: 1024 });
  return { room, pidChain: [{ pid: callerPid, pid_start: `ps${callerPid}` }] };
}

describe('POST /api/chat-rooms/:roomId/screenshots/:sha/prune', () => {
  it('200 + changed=true on first prune + list excludes the row', async () => {
    const sha = 'a'.repeat(64);
    const { room, pidChain } = setupRoomWithMemberCallerAndScreenshot(sha, 8001);
    const response = await callPost(room.id, sha, { pidChain });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sha).toBe(sha);
    expect(body.changed).toBe(true);
    expect(listScreenshotsForRoom(room.id)).toEqual([]);
  });

  it('200 + changed=false on second prune (idempotent)', async () => {
    const sha = 'b'.repeat(64);
    const { room, pidChain } = setupRoomWithMemberCallerAndScreenshot(sha, 8002);
    await callPost(room.id, sha, { pidChain });
    const second = await callPost(room.id, sha, { pidChain });
    expect(second.status).toBe(200);
    expect((await second.json()).changed).toBe(false);
  });

  it('404 on unknown room', async () => {
    const sha = 'c'.repeat(64);
    const response = await callPost('phantom', sha, { pidChain: [{ pid: 1, pid_start: 'x' }] });
    expect(response.status).toBe(404);
  });

  it('404 on unknown sha in real room', async () => {
    const sha = 'd'.repeat(64);
    const { room, pidChain } = setupRoomWithMemberCallerAndScreenshot(sha, 8004);
    const response = await callPost(room.id, 'e'.repeat(64), { pidChain });
    expect(response.status).toBe(404);
  });

  it('403 when pidChain identity does not resolve to a room member', async () => {
    const sha = 'f'.repeat(64);
    const { room } = setupRoomWithMemberCallerAndScreenshot(sha, 8005);
    const response = await callPost(room.id, sha, {
      pidChain: [{ pid: 99999, pid_start: 'unknown' }]
    });
    expect(response.status).toBe(403);
  });

  it('400 when body is empty / not JSON', async () => {
    const sha = '1'.repeat(64);
    const { room } = setupRoomWithMemberCallerAndScreenshot(sha, 8006);
    const url = `http://localhost/api/chat-rooms/${room.id}/screenshots/${sha}/prune`;
    const request = new Request(url, { method: 'POST', body: '' });
    const event = { request, params: { roomId: room.id, sha } } as unknown as Parameters<typeof POST>[0];
    let response: Response;
    try { response = (await POST(event)) as Response; }
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
