import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '\$lib/server/chatRoomStore';
import { createPairingToken } from '\$lib/server/pairingTokenStore';
import { GET, POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_API_KEY = process.env.ANT_API_KEY;
const TEST_API_KEY = 'test-api-key-123';

type AnyHandler = (event: unknown) => unknown;

function getEvent(search: string) {
  return {
    request: new Request(`http://localhost/api/pairing-tokens${search}`),
    url: new URL(`http://localhost/api/pairing-tokens${search}`)
  };
}

function postEvent(body: unknown) {
  return {
    request: new Request('http://localhost/api/pairing-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    url: new URL('http://localhost/api/pairing-tokens')
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
  process.env.ANT_API_KEY = TEST_API_KEY;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_API_KEY === undefined) delete process.env.ANT_API_KEY;
  else process.env.ANT_API_KEY = PREV_API_KEY;
});

describe('/api/pairing-tokens', () => {
  it('GET 400 without roomId', async () => {
    const res = await run(GET as unknown as AnyHandler, getEvent(''));
    expect(res.status).toBe(400);
  });

  it('GET 404 for unknown room', async () => {
    const res = await run(GET as unknown as AnyHandler, getEvent('?roomId=missing'));
    expect(res.status).toBe(404);
  });

  it('GET lists tokens for a room', async () => {
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    createPairingToken({ room_id: room.id, server_url: 'http://test', api_key: TEST_API_KEY });
    const res = await run(GET as unknown as AnyHandler, getEvent(`?roomId=${room.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokens.length).toBe(1);
    expect(body.tokens[0].room_id).toBe(room.id);
  });

  it('POST creates a token', async () => {
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    const res = await run(POST as unknown as AnyHandler, postEvent({
      roomId: room.id,
      apiKey: TEST_API_KEY
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token.room_id).toBe(room.id);
    expect(body.token.token).toBeTruthy();
  });

  it('POST 400 without roomId', async () => {
    const res = await run(POST as unknown as AnyHandler, postEvent({ apiKey: TEST_API_KEY }));
    expect(res.status).toBe(400);
  });

  it('POST 404 for unknown room', async () => {
    const res = await run(POST as unknown as AnyHandler, postEvent({ roomId: 'missing', apiKey: TEST_API_KEY }));
    expect(res.status).toBe(404);
  });

  it('POST 400 without apiKey when env not set', async () => {
    delete process.env.ANT_API_KEY;
    const room = createChatRoom({ name: 'Pair Room', whoCreatedIt: '@you' });
    const res = await run(POST as unknown as AnyHandler, postEvent({ roomId: room.id }));
    expect(res.status).toBe(400);
  });
});
