import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '\$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '\$lib/server/chatMessageStore';
import { createBrowserSession } from '\$lib/server/browserSessionStore';
import { canonicaliseOperatorHandle } from '\$lib/server/operatorHandle';
import { DELETE, PATCH } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(roomId: string, messageId: string, method: 'DELETE' | 'PATCH', cookie = '', body?: unknown) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/messages/${messageId}`);
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  init.headers = headers;
  return {
    request: new Request(url, init),
    url,
    params: { roomId, messageId }
  };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

async function memberCookie(roomId: string, handle = '@you'): Promise<string> {
  const db = (await import('\$lib/server/db')).getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const storageHandle = canonicaliseOperatorHandle(handle);
  const termId = `t_${storageHandle.slice(1)}_${roomId.slice(0, 8)}`;
  const memId = `mem_${storageHandle.slice(1)}_${roomId.slice(0, 8)}`;
  const bsId = `bs_${storageHandle.slice(1)}_${roomId.slice(0, 8)}`;
  db.prepare(`INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at) VALUES (?, 0, 'test', ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`)
    .run(termId, termId, nowSec + 99999, nowSec, nowSec);
  db.prepare(`INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(memId, roomId, storageHandle, termId, nowSec);
  const result = createBrowserSession({ roomId, authorHandle: handle, browserSessionId: bsId });
  if (!result) throw new Error('Failed to create browser session');
  return result.browserSessionSecret;
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
});

afterEach(() => {
  resetChatMessageStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/chat-rooms/:roomId/messages/:messageId', () => {
  it('DELETE soft-deletes the author\'s own message', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const msg = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const cookie = await memberCookie(room.id, '@you');
    const res = await run(DELETE as unknown as AnyHandler, eventFor(room.id, msg.id, 'DELETE', `ant_browser_session=${cookie}`));
    expect(res.status).toBe(204);
  });

  it('DELETE 403s for non-author', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const msg = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const cookie = await memberCookie(room.id, '@other');
    const res = await run(DELETE as unknown as AnyHandler, eventFor(room.id, msg.id, 'DELETE', `ant_browser_session=${cookie}`));
    expect(res.status).toBe(403);
  });

  it('DELETE 404s for missing message', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const cookie = await memberCookie(room.id, '@you');
    const res = await run(DELETE as unknown as AnyHandler, eventFor(room.id, 'ghost', 'DELETE', `ant_browser_session=${cookie}`));
    expect(res.status).toBe(404);
  });

  it('DELETE 401s without identity', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const msg = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor(room.id, msg.id, 'DELETE'));
    expect(res.status).toBe(401);
  });

  it("DELETE iterates multiple ant_browser_session cookies (JWPK msg_nla01cyqyw 2026-05-19)", async () => {
    // Regression for the "can't delete in antv4" case: demo-login mints
    // Path=/ + per-room mint adds Path=/api/chat-rooms/{id}, browsers
    // send BOTH on requests to the room API. The first-match-only read
    // used to ignore the second cookie, so a stale Path=/ value masked
    // a valid Path=/api/chat-rooms/{id} cookie. Resolver now iterates.
    const room = createChatRoom({ name: 'multi-cookie-delete', whoCreatedIt: '@you' });
    const msg = postMessage({ roomId: room.id, authorHandle: '@you', body: 'goodbye' });
    const validCookie = await memberCookie(room.id, '@you');
    const cookieHeader = `ant_browser_session=bws_stale_demo_login; ant_browser_session=${validCookie}`;
    const res = await run(DELETE as unknown as AnyHandler, eventFor(room.id, msg.id, 'DELETE', cookieHeader));
    expect(res.status).toBe(204);
  });

  it('PATCH edits the author\'s own message', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const msg = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const cookie = await memberCookie(room.id, '@you');
    const res = await run(PATCH as unknown as AnyHandler, eventFor(room.id, msg.id, 'PATCH', `ant_browser_session=${cookie}`, { body: 'edited' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.body).toBe('edited');
    expect(body.message.editedAtMs).toBeGreaterThan(0);
  });

  it('PATCH 400s on empty body', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const msg = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const cookie = await memberCookie(room.id, '@you');
    const res = await run(PATCH as unknown as AnyHandler, eventFor(room.id, msg.id, 'PATCH', `ant_browser_session=${cookie}`, { body: '' }));
    expect(res.status).toBe(400);
  });

  it('PATCH 403s for non-author', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const msg = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const cookie = await memberCookie(room.id, '@other');
    const res = await run(PATCH as unknown as AnyHandler, eventFor(room.id, msg.id, 'PATCH', `ant_browser_session=${cookie}`, { body: 'edited' }));
    expect(res.status).toBe(403);
  });

  it('PATCH 409s for deleted message', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const msg = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const cookie = await memberCookie(room.id, '@you');
    await run(DELETE as unknown as AnyHandler, eventFor(room.id, msg.id, 'DELETE', `ant_browser_session=${cookie}`));
    const res = await run(PATCH as unknown as AnyHandler, eventFor(room.id, msg.id, 'PATCH', `ant_browser_session=${cookie}`, { body: 'edited' }));
    expect(res.status).toBe(409);
  });
});
