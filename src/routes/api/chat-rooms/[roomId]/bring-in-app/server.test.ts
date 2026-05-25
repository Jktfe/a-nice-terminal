import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { resetChatMessageStoreForTests, postMessage } from '$lib/server/chatMessageStore';
import { listBringInLaunchesForOperator } from '$lib/server/bringInAppStore';

const ADMIN_TOKEN = 'test-admin-token-bring-in-app';

type AnyHandler = (event: unknown) => unknown;

let tmpDir: string;
const previousDb = process.env.ANT_FRESH_DB_PATH;
const previousAdmin = process.env.ANT_ADMIN_TOKEN;

function eventFor(
  roomId: string,
  opts: { cookie?: string; bearer?: string; body?: unknown } = {}
) {
  const url = new URL(`http://localhost/api/chat-rooms/${encodeURIComponent(roomId)}/bring-in-app`);
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const init: RequestInit = { method: 'POST', headers };
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  return { request: new Request(url, init), url, params: { roomId } };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') {
      return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    }
    throw thrown;
  }
}

describe('POST /api/chat-rooms/:roomId/bring-in-app', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-bring-in-app-test-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'fresh.db');
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDb;
    if (previousAdmin === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdmin;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('401s without auth', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const res = await run(POST as unknown as AnyHandler, eventFor(room.id, { body: { target: 'claude-desktop' } }));
    expect(res.status).toBe(401);
  });

  it('404s for unknown room', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('ghost', { bearer: ADMIN_TOKEN, body: { target: 'claude-desktop' } }));
    expect(res.status).toBe(404);
  });

  it('400s for missing target', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const res = await run(POST as unknown as AnyHandler, eventFor(room.id, { bearer: ADMIN_TOKEN, body: {} }));
    expect(res.status).toBe(400);
  });

  it('400s for invalid target', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const res = await run(POST as unknown as AnyHandler, eventFor(room.id, { bearer: ADMIN_TOKEN, body: { target: 'notepad' } }));
    expect(res.status).toBe(400);
  });

  it('mints a payload + records the launch for valid targets', async () => {
    const room = createChatRoom({ name: 'Test room', whoCreatedIt: '@you' });
    postMessage({
      roomId: room.id,
      body: 'hello world',
      kind: 'human',
      authorHandle: '@you',
      authorDisplayName: 'You'
    });
    const res = await run(POST as unknown as AnyHandler, eventFor(room.id, {
      bearer: ADMIN_TOKEN,
      body: { target: 'claude-desktop' }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.launchId).toMatch(/^bia_/);
    expect(body.target).toBe('claude-desktop');
    expect(body.payload.roomId).toBe(room.id);
    expect(body.payload.roomName).toBe('Test room');
    expect(body.payload.recentMessagesMarkdown).toContain('hello world');

    // Launch recorded in audit table.
    const launches = listBringInLaunchesForOperator('@admin', 10);
    expect(launches).toHaveLength(1);
    expect(launches[0].target).toBe('claude-desktop');
    expect(launches[0].roomId).toBe(room.id);
  });

  it('records distinct launches for each target', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    for (const target of ['claude-desktop', 'chatgpt', 'gemini']) {
      const res = await run(POST as unknown as AnyHandler, eventFor(room.id, {
        bearer: ADMIN_TOKEN,
        body: { target }
      }));
      expect(res.status).toBe(200);
    }
    const launches = listBringInLaunchesForOperator('@admin', 10);
    expect(launches.map((l) => l.target).sort()).toEqual(['chatgpt', 'claude-desktop', 'gemini']);
  });
});
