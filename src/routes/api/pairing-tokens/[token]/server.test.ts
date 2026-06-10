import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '\$lib/server/chatRoomStore';
import { createPairingToken } from '\$lib/server/pairingTokenStore';
import { GET, POST, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'pairing-token-test-admin';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  { admin = false }: { admin?: boolean } = {}
) {
  const url = new URL(`http://localhost/api/pairing-tokens/${token}`);
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (admin) headers.authorization = `Bearer ${ADMIN_TOKEN}`;
  if (Object.keys(headers).length > 0) init.headers = headers;
  return {
    request: new Request(url, init),
    url,
    params: { token }
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

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN;
});

describe('/api/pairing-tokens/:token', () => {
  it('GET returns the token', async () => {
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key' });
    const res = await run(GET as unknown as AnyHandler, eventFor(pt.token, 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token.room_id).toBe(room.id);
  });

  it('GET 404 for missing token', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET'));
    expect(res.status).toBe(404);
  });

  it('POST consumes the token', async () => {
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key' });
    const res = await run(POST as unknown as AnyHandler, eventFor(pt.token, 'POST', { deviceName: 'iPhone' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token.consumed_at_ms).toBeTruthy();
    expect(body.token.api_key).toBe('key');
  });

  it('POST 404 for missing token', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('missing', 'POST'));
    expect(res.status).toBe(404);
  });

  it('POST 410 for already consumed token', async () => {
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key' });
    await run(POST as unknown as AnyHandler, eventFor(pt.token, 'POST', { deviceName: 'iPhone' }));
    const res2 = await run(POST as unknown as AnyHandler, eventFor(pt.token, 'POST'));
    expect(res2.status).toBe(410);
  });

  it('POST 410 for expired token', async () => {
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key', expires_at_ms: Date.now() - 1000 });
    const res = await run(POST as unknown as AnyHandler, eventFor(pt.token, 'POST'));
    expect(res.status).toBe(410);
  });

  it('DELETE revokes the token with admin auth', async () => {
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor(pt.token, 'DELETE', undefined, { admin: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Actually revoked now (previously a no-op that lied): a re-consume 404s.
    const after = await run(POST as unknown as AnyHandler, eventFor(pt.token, 'POST'));
    expect(after.status).toBe(404);
  });

  it('DELETE 401 without auth — cannot revoke another caller’s token', async () => {
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor(pt.token, 'DELETE'));
    expect(res.status).toBe(401);
  });

  it('DELETE 404 for missing token (before the auth gate)', async () => {
    const res = await run(DELETE as unknown as AnyHandler, eventFor('missing', 'DELETE'));
    expect(res.status).toBe(404);
  });
});
