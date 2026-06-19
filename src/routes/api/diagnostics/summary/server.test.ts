import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { broadcastToRoom, resetEventBroadcastForTests, subscribeToRoom } from '$lib/server/eventBroadcast';
import { GET } from './+server';

const PREV_DB = process.env.ANT_FRESH_DB_PATH;
const PREV_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'summary-admin-token';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetEventBroadcastForTests();
});

afterEach(() => {
  resetEventBroadcastForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB;
  if (PREV_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_TOKEN;
});

describe('GET /api/diagnostics/summary', () => {
  async function callGet(headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }): Promise<Response> {
    const request = new Request('http://localhost/api/diagnostics/summary', { headers });
    return (await GET({ request } as Parameters<typeof GET>[0])) as Response;
  }

  async function callGetOrCaught(headers: HeadersInit = {}): Promise<Response> {
    try {
      return await callGet(headers);
    } catch (thrown) {
      if (thrown instanceof Response) return thrown;
      const failure = thrown as { status?: number; body?: { message?: string } };
      if (typeof failure?.status === 'number') {
        return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
      }
      throw thrown;
    }
  }

  it('rejects anonymous diagnostics summary reads', async () => {
    const res = await callGetOrCaught({});
    expect(res.status).toBe(401);
  });

  it('returns operator diagnostics without leaking admin secrets', async () => {
    const room = createChatRoom({ name: 'summary-room', whoCreatedIt: '@test' });
    const controller = {
      enqueue: () => {},
      close: () => {},
      desiredSize: 1
    } as unknown as ReadableStreamDefaultController<Uint8Array>;
    subscribeToRoom(room.id, controller);
    broadcastToRoom(room.id, { type: 'diagnostics_probe' });

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.pid).toBe(process.pid);
    expect(body.nodeVersion).toMatch(/^v/);
    expect(body.db).toMatchObject({
      reachable: true,
      path: ':memory:',
      mainBytes: expect.any(Number),
      mainSize: expect.any(String)
    });
    expect(body.sse).toMatchObject({
      totalSubscribers: 1,
      totalBroadcasts: 1,
      totalSubscriberDeliveries: 1,
      totalSubscriberDrops: 0,
      rooms: expect.arrayContaining([
        expect.objectContaining({
          roomId: room.id,
          roomName: 'summary-room',
          count: 1,
          currentSeq: 1,
          eventsBroadcast: 1,
          subscriberDeliveries: 1,
          subscriberDrops: 0,
          backpressureDrops: 0,
          enqueueErrorDrops: 0,
          lastBroadcastSeq: 1,
          lastDropReason: null
        })
      ])
    });
    expect(body.cliHookLag).toMatchObject({
      latestSec: -1,
      p50Sec: -1,
      p99Sec: -1,
      sampleCount: 0
    });
    expect(body.sampledAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(ADMIN_TOKEN);
  });
});
