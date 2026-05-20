import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';

async function callGet(rawUrl: string): Promise<Response> {
  const fullUrl = new URL(`http://localhost${rawUrl}`);
  const event = {
    request: new Request(fullUrl),
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
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
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
