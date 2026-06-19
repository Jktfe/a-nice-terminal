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
  currentSeqForRoom: vi.fn().mockReturnValue(7)
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN = process.env.ANT_ADMIN_TOKEN;

type AnyHandler = (event: unknown) => unknown;

function eventFor(roomId: string, query = '', withAuth = true) {
  const url = new URL(`http://localhost/api/realtime/${roomId}/events/backfill${query}`);
  const headers: Record<string, string> = {};
  if (withAuth) headers.authorization = 'Bearer realtime-admin';
  return {
    request: new Request(url, { headers }),
    url,
    params: { roomId }
  };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: unknown };
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
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN;
  vi.restoreAllMocks();
});

describe('/api/realtime/:roomId/events/backfill', () => {
  it('GET requires room read access before exposing sequence state', async () => {
    const response = await run(GET as unknown as AnyHandler, eventFor('room-1', '', false));

    expect(response.status).toBe(401);
  });

  it('GET rejects malformed since_seq values', async () => {
    const response = await run(GET as unknown as AnyHandler, eventFor('room-1', '?since_seq=-1'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'since_seq must be a non-negative integer when supplied.'
    });
  });

  it('GET returns no-gap when since_seq is at the latest sequence', async () => {
    const response = await run(GET as unknown as AnyHandler, eventFor('room-1', '?since_seq=7'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      events: [],
      latest_seq: 7,
      gap: false
    });
  });

  it('GET returns honest 410 when v0 cannot backfill an older sequence', async () => {
    const response = await run(GET as unknown as AnyHandler, eventFor('room-1', '?since_seq=3'));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Backfill not available (events not persisted in v0). Resume from latest_seq.',
      latest_seq: 7
    });
  });

  it('GET 404s when the room is missing', async () => {
    const { findChatRoomById } = await import('\$lib/server/chatRoomStore');
    vi.mocked(findChatRoomById).mockReturnValue(undefined);

    const response = await run(GET as unknown as AnyHandler, eventFor('missing'));

    expect(response.status).toBe(404);
  });
});
