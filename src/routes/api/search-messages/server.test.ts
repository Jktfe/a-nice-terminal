import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  postBreakMessage,
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';

const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'search-test-admin-token';

async function callGet(rawUrl: string, token: string | null = ADMIN_TOKEN): Promise<Response> {
  const fullUrl = new URL(`http://localhost${rawUrl}`);
  const headers = new Headers();
  if (token !== null) {
    headers.set('authorization', `Bearer ${token}`);
  }
  const event = {
    request: new Request(fullUrl, { headers }),
    params: {},
    url: fullUrl
  } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

describe('GET /api/search-messages', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterAll(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  });

  it('returns 200 with newest-first hits across rooms', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'pizza Friday' });
    postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'leftover Pizza' });

    const response = await callGet('/api/search-messages?query=pizza');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hits).toHaveLength(2);
    expect(body.hits[0].message.body).toBe('leftover Pizza');
    expect(body.hits[0].roomName).toBe('B');
  });

  it('returns 401 for a valid cross-room search without a readable-room identity', async () => {
    const room = createChatRoom({ name: 'Private', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'needle secret' });

    const response = await callGet('/api/search-messages?query=needle', null);
    expect(response.status).toBe(401);
  });

  it('returns 400 when query is missing', async () => {
    const response = await callGet('/api/search-messages');
    expect(response.status).toBe(400);
  });

  it('returns 400 when query is only whitespace', async () => {
    const response = await callGet('/api/search-messages?query=%20%20%20');
    expect(response.status).toBe(400);
  });

  it('scopes results when roomId is provided', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'pizza' });
    postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'pizza' });

    const response = await callGet(
      `/api/search-messages?query=pizza&roomId=${roomA.id}`
    );
    const body = await response.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].roomId).toBe(roomA.id);
  });

  it('defaults room-scoped search to the current block after the latest break', async () => {
    const room = createChatRoom({ name: 'Scoped Block', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'scopeword before break' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'new section' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'scopeword after break' });

    const response = await callGet(
      `/api/search-messages?query=scopeword&roomId=${room.id}`
    );
    const body = await response.json();

    expect(body.hits.map((hit: { message: { body: string } }) => hit.message.body)).toEqual([
      'scopeword after break'
    ]);
    expect(body.allContent).toBe(false);
  });

  it('keeps full room history available when allContent is explicitly enabled', async () => {
    const room = createChatRoom({ name: 'Scoped Full', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'scopefull before break' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'new section' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'scopefull after break' });

    const response = await callGet(
      `/api/search-messages?query=scopefull&roomId=${room.id}&allContent=1`
    );
    const body = await response.json();

    expect(body.hits.map((hit: { message: { body: string } }) => hit.message.body)).toEqual([
      'scopefull after break',
      'scopefull before break'
    ]);
    expect(body.allContent).toBe(true);
  });

  it('treats whitespace-only roomId as unscoped (all rooms)', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'pizza' });
    postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'pizza' });

    const response = await callGet('/api/search-messages?query=pizza&roomId=%20%20');
    const body = await response.json();
    expect(body.hits).toHaveLength(2);
  });

  it('returns 404 when roomId is provided but unknown', async () => {
    const response = await callGet(
      '/api/search-messages?query=hi&roomId=does_not_exist'
    );
    expect(response.status).toBe(404);
  });

  it('returns 200 with empty hits when nothing matches', async () => {
    const room = createChatRoom({ name: 'X', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const response = await callGet('/api/search-messages?query=banana');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hits).toEqual([]);
  });

  it('honours a small explicit limit', async () => {
    const room = createChatRoom({ name: 'few', whoCreatedIt: '@you' });
    for (let index = 0; index < 10; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const response = await callGet('/api/search-messages?query=match&limit=4');
    const body = await response.json();
    expect(body.hits).toHaveLength(4);
  });

  it('ignores a non-numeric limit and uses the default', async () => {
    const room = createChatRoom({ name: 'lots', whoCreatedIt: '@you' });
    for (let index = 0; index < 60; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const response = await callGet('/api/search-messages?query=match&limit=banana');
    const body = await response.json();
    expect(body.hits).toHaveLength(50);
  });

  it('returns 200 with empty hits when there are no rooms', async () => {
    const response = await callGet('/api/search-messages?query=anything');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hits).toEqual([]);
  });
});
