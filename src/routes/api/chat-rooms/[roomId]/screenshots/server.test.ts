import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from './+server';
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
  resetScreenshotIndexStoreForTests,
  softDeleteScreenshot
} from '$lib/server/screenshotIndexStore';

let tmpDir: string;
let uploadDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousUploadRoot = process.env.ANT_UPLOAD_ROOT;

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000005000100',
  'hex'
);
const PNG_B64 = PNG_BYTES.toString('base64');

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-screenshots-list-'));
  uploadDir = mkdtempSync(join(tmpdir(), 'ant-screenshots-up-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_UPLOAD_ROOT = uploadDir;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetScreenshotIndexStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(uploadDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousUploadRoot === undefined) delete process.env.ANT_UPLOAD_ROOT;
  else process.env.ANT_UPLOAD_ROOT = previousUploadRoot;
});

async function callGet(roomId: string): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/screenshots`;
  const request = new Request(url, { method: 'GET' });
  const event = { request, params: { roomId } } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (t) {
    if (t instanceof Response) return t;
    const f = t as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') {
      return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    }
    throw t;
  }
}

describe('GET /api/chat-rooms/:roomId/screenshots', () => {
  it('404 on unknown room', async () => {
    const response = await callGet('phantom');
    expect(response.status).toBe(404);
  });

  it('200 + empty list when no screenshots in room', async () => {
    const room = createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.screenshots).toEqual([]);
  });

  it('200 + list newest-first', async () => {
    const room = createChatRoom({ name: 'pop', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    checkDedupAndReserve({ roomId: room.id, sha: 'a'.repeat(64), takenBy: '@you', bytes: 1024, nowMs: 100 });
    checkDedupAndReserve({ roomId: room.id, sha: 'b'.repeat(64), takenBy: '@you', bytes: 1024, nowMs: 200 });
    const response = await callGet(room.id);
    const body = await response.json();
    expect(body.screenshots.map((r: { taken_at_ms: number }) => r.taken_at_ms)).toEqual([200, 100]);
  });

  it('excludes soft-deleted rows', async () => {
    const room = createChatRoom({ name: 'soft', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    checkDedupAndReserve({ roomId: room.id, sha: 'a'.repeat(64), takenBy: '@you', bytes: 1024 });
    checkDedupAndReserve({ roomId: room.id, sha: 'b'.repeat(64), takenBy: '@you', bytes: 1024 });
    softDeleteScreenshot('a'.repeat(64), room.id);
    const response = await callGet(room.id);
    const body = await response.json();
    expect(body.screenshots).toHaveLength(1);
    expect(body.screenshots[0].sha).toBe('b'.repeat(64));
  });
});

async function callPost(roomId: string, body: object): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/screenshots`;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const event = { request, params: { roomId } } as unknown as Parameters<typeof POST>[0];
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

function setupRoomWithMemberCaller(name: string, callerPid: number) {
  const room = createChatRoom({ name, whoCreatedIt: '@you' });
  const term = upsertTerminal({ pid: callerPid, pid_start: `ps${callerPid}`, name: '@caller' });
  addMembership({ room_id: room.id, handle: '@caller', terminal_id: term.id });
  return { room, pidChain: [{ pid: callerPid, pid_start: `ps${callerPid}` }] };
}

describe('POST /api/chat-rooms/:roomId/screenshots — capture', () => {
  it('200 + kind=inserted + canonical file on disk + row persisted', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('cap', 9001);
    enableSharedFolder(room.id, true);
    const response = await callPost(room.id, {
      bytes: PNG_B64, takenBy: '@caller', topic: 'demo', pidChain
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe('inserted');
    expect(body.sha.length).toBe(64);
    expect(existsSync(body.canonicalPath)).toBe(true);
    expect(body.row.bytes).toBe(PNG_BYTES.length);
  });

  it('200 + kind=existing on duplicate sha (no overwrite)', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('dup', 9002);
    enableSharedFolder(room.id, true);
    const first = await callPost(room.id, { bytes: PNG_B64, takenBy: '@caller', pidChain });
    const second = await callPost(room.id, { bytes: PNG_B64, takenBy: '@caller', pidChain });
    expect((await second.json()).kind).toBe('existing');
    expect((await first.json()).sha).not.toBe(''); // sanity
  });

  it('409 + SharedFolderDisabled when room flag OFF', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('off', 9003);
    const response = await callPost(room.id, { bytes: PNG_B64, takenBy: '@caller', pidChain });
    expect(response.status).toBe(409);
  });

  it('404 on unknown room', async () => {
    const response = await callPost('phantom', { bytes: PNG_B64, takenBy: '@caller', pidChain: [{ pid: 1, pid_start: 'x' }] });
    expect(response.status).toBe(404);
  });

  it('403 when pidChain identity does not resolve to a room member', async () => {
    const { room } = setupRoomWithMemberCaller('badid', 9005);
    enableSharedFolder(room.id, true);
    const response = await callPost(room.id, {
      bytes: PNG_B64, takenBy: '@caller', pidChain: [{ pid: 99999, pid_start: 'unknown' }]
    });
    expect(response.status).toBe(403);
  });

  it('400 when bytes is missing or empty', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('nobytes', 9006);
    enableSharedFolder(room.id, true);
    const a = await callPost(room.id, { takenBy: '@caller', pidChain } as object);
    expect(a.status).toBe(400);
    const b = await callPost(room.id, { bytes: '', takenBy: '@caller', pidChain });
    expect(b.status).toBe(400);
  });

  it('attributes to the AUTHENTICATED identity, ignoring a spoofed body.takenBy (security 2026-06-10)', async () => {
    // Previously takenBy was read from the request body, so any authenticated
    // caller could attribute a screenshot to ANY handle (incl. the operator
    // @JWPK). The fix uses the resolveCallerIdentityStrict handle instead.
    const { room, pidChain } = setupRoomWithMemberCaller('spoof', 9007);
    enableSharedFolder(room.id, true);
    // Caller resolves to @caller via pidChain, but tries to spoof takenBy=@JWPK.
    const response = await callPost(room.id, { bytes: PNG_B64, takenBy: '@JWPK', pidChain });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.row.taken_by).toBe('@caller'); // authenticated identity, NOT the spoofed @JWPK
  });

  it('200 without a body takenBy — attribution comes from the authenticated identity', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('noby', 9008);
    enableSharedFolder(room.id, true);
    const response = await callPost(room.id, { bytes: PNG_B64, pidChain } as object);
    expect(response.status).toBe(200);
    expect((await response.json()).row.taken_by).toBe('@caller');
  });
});
