import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { GET } from './+server';

vi.mock('\$lib/server/chatRoomStore', () => ({
  findChatRoomById: vi.fn().mockReturnValue({
    id: 'room-1',
    name: 'Room 1',
    members: [{ handle: '@you' }]
  })
}));

vi.mock('\$lib/server/eventBroadcast', () => ({
  subscribeToRoom: vi.fn().mockReturnValue(() => {}),
  unsubscribeFromRoom: vi.fn(),
  currentSeqForRoom: vi.fn().mockReturnValue(0)
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(roomId: string) {
  return {
    request: new Request(`http://localhost/api/realtime/${roomId}/events`),
    url: new URL(`http://localhost/api/realtime/${roomId}/events`),
    params: { roomId }
  };
}

function adminEventFor(roomId: string) {
  return {
    request: new Request(`http://localhost/api/realtime/${roomId}/events`, {
      headers: { authorization: 'Bearer realtime-admin' }
    }),
    url: new URL(`http://localhost/api/realtime/${roomId}/events`),
    params: { roomId }
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
  process.env.ANT_ADMIN_TOKEN = 'realtime-admin';
  resetIdentityDbForTests();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  delete process.env.ANT_ADMIN_TOKEN;
});

describe('/api/realtime/:roomId/events', () => {
  it('GET rejects unauthenticated SSE subscribers', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('room-1'));
    expect(res.status).toBe(401);
  });

  it('GET returns SSE stream', async () => {
    const res = await run(GET as unknown as AnyHandler, adminEventFor('room-1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });

  it('GET 400 on empty roomId', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(400);
  });

  it('GET 404 for missing room', async () => {
    const { findChatRoomById } = await import('\$lib/server/chatRoomStore');
    vi.mocked(findChatRoomById).mockReturnValue(undefined);
    const res = await run(GET as unknown as AnyHandler, adminEventFor('missing'));
    expect(res.status).toBe(404);
  });
});
