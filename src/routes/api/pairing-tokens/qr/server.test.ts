import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '\$lib/server/chatRoomStore';
import { createPairingToken } from '\$lib/server/pairingTokenStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(search: string) {
  return {
    request: new Request(`http://localhost/api/pairing-tokens/qr${search}`),
    url: new URL(`http://localhost/api/pairing-tokens/qr${search}`)
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
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/pairing-tokens/qr', () => {
  it('GET returns SVG for a valid token', async () => {
    const room = createChatRoom({ name: 'QR Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key' });
    const res = await run(GET as unknown as AnyHandler, eventFor(`?token=${pt.token}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    const body = await res.text();
    expect(body).toContain('<svg');
  });

  it('GET 400 without token', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(400);
  });

  it('GET 404 for missing token', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('?token=missing'));
    expect(res.status).toBe(404);
  });

  it('GET 410 for consumed token', async () => {
    const room = createChatRoom({ name: 'QR Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key' });
    // consume it first
    const { consumePairingToken } = await import('\$lib/server/pairingTokenStore');
    consumePairingToken(pt.token, 'device');
    const res = await run(GET as unknown as AnyHandler, eventFor(`?token=${pt.token}`));
    expect(res.status).toBe(410);
  });

  it('GET 410 for expired token', async () => {
    const room = createChatRoom({ name: 'QR Room', whoCreatedIt: '@you' });
    const pt = createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: 'key', expires_at_ms: Date.now() - 1000 });
    const res = await run(GET as unknown as AnyHandler, eventFor(`?token=${pt.token}`));
    expect(res.status).toBe(410);
  });
});
