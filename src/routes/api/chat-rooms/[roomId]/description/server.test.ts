import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PATCH } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  createChatRoom,
  resetChatRoomStoreForTests,
  ROOM_DESCRIPTION_MAX_CHARS,
  updateChatRoomDescription,
  findChatRoomById
} from '$lib/server/chatRoomStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';

const ADMIN_TOKEN = 'test-admin-token-room-description';

type AnyHandler = (event: unknown) => unknown;

let tmpDir: string;
const previousDb = process.env.ANT_FRESH_DB_PATH;
const previousAdmin = process.env.ANT_ADMIN_TOKEN;

function eventFor(
  roomId: string,
  opts: { cookie?: string; bearer?: string; body?: unknown } = {}
) {
  const url = new URL(`http://localhost/api/chat-rooms/${encodeURIComponent(roomId)}/description`);
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const init: RequestInit = { method: 'PATCH', headers };
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

async function makeRoomWithSessionFor(handle: string): Promise<{ roomId: string; cookie: string }> {
  const room = createChatRoom({ name: 'desc-test-room', whoCreatedIt: handle });
  const db = (await import('$lib/server/db')).getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, 0, 'test', ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`
  ).run(`t_${handle}`, `term-${handle}`, nowSec + 99999, nowSec, nowSec);
  db.prepare(
    `INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`mem-${handle}-${room.id}`, room.id, handle, `t_${handle}`, nowSec);
  const result = createBrowserSession({ roomId: room.id, authorHandle: handle, browserSessionId: `bs_${handle}_${room.id}` });
  if (!result) throw new Error('Failed to create browser session');
  return { roomId: room.id, cookie: `ant_browser_session=${result.browserSessionSecret}` };
}

describe('updateChatRoomDescription store mutator', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-desc-store-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'fresh.db');
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDb;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('round-trips a description, trimming whitespace', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const updated = updateChatRoomDescription({
      roomId: room.id,
      description: '   Hello room friends.  '
    });
    expect(updated.description).toBe('Hello room friends.');
    expect(findChatRoomById(room.id)?.description).toBe('Hello room friends.');
  });

  it('clears description when given null', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    updateChatRoomDescription({ roomId: room.id, description: 'first pass' });
    const cleared = updateChatRoomDescription({ roomId: room.id, description: null });
    expect(cleared.description).toBeNull();
    expect(findChatRoomById(room.id)?.description).toBeNull();
  });

  it('clears description when given empty/whitespace string', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    updateChatRoomDescription({ roomId: room.id, description: 'before' });
    const cleared = updateChatRoomDescription({ roomId: room.id, description: '   ' });
    expect(cleared.description).toBeNull();
  });

  it('rejects descriptions longer than the cap', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    expect(() => updateChatRoomDescription({
      roomId: room.id,
      description: 'a'.repeat(ROOM_DESCRIPTION_MAX_CHARS + 1)
    })).toThrow(/exceed/);
  });
});

describe('PATCH /api/chat-rooms/:roomId/description endpoint', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-desc-api-'));
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
    const res = await run(PATCH as unknown as AnyHandler, eventFor(room.id, { body: { description: 'hi' } }));
    expect(res.status).toBe(401);
  });

  it('404s for unknown roomId', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('ghost', { bearer: ADMIN_TOKEN, body: { description: 'hi' } }));
    expect(res.status).toBe(404);
  });

  it('admin bearer can set + clear description', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const setRes = await run(PATCH as unknown as AnyHandler, eventFor(room.id, {
      bearer: ADMIN_TOKEN,
      body: { description: 'Quarterly board meeting prep.' }
    }));
    expect(setRes.status).toBe(200);
    expect((await setRes.json()).chatRoom.description).toBe('Quarterly board meeting prep.');

    const clearRes = await run(PATCH as unknown as AnyHandler, eventFor(room.id, {
      bearer: ADMIN_TOKEN,
      body: { description: null }
    }));
    expect(clearRes.status).toBe(200);
    expect((await clearRes.json()).chatRoom.description).toBeNull();
  });

  it('room-member browser session can set description', async () => {
    const { roomId, cookie } = await makeRoomWithSessionFor('@you');
    const res = await run(PATCH as unknown as AnyHandler, eventFor(roomId, {
      cookie,
      body: { description: 'Set by the room member.' }
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).chatRoom.description).toBe('Set by the room member.');
  });

  it('rejects non-string non-null description with 400', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor(room.id, {
      bearer: ADMIN_TOKEN,
      body: { description: 42 }
    }));
    expect(res.status).toBe(400);
  });

  it('rejects over-cap description with 400', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor(room.id, {
      bearer: ADMIN_TOKEN,
      body: { description: 'x'.repeat(ROOM_DESCRIPTION_MAX_CHARS + 1) }
    }));
    expect(res.status).toBe(400);
  });
});
