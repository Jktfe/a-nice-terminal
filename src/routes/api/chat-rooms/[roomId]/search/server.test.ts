import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';

async function callGet(roomId: string, rawQs: string): Promise<Response> {
  const fullUrl = new URL(`http://localhost/api/chat-rooms/${roomId}/search${rawQs}`);
  const event = {
    request: new Request(fullUrl),
    params: { roomId },
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

describe('GET /api/chat-rooms/[roomId]/search', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('returns 400 when q is missing', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callGet(room.id, '');
    expect(response.status).toBe(400);
  });

  it('returns 400 when q is only whitespace', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callGet(room.id, '?q=%20%20%20');
    expect(response.status).toBe(400);
  });

  it('returns 404 when the room does not exist', async () => {
    const response = await callGet('no_such_room', '?q=hi');
    expect(response.status).toBe(404);
  });

  it('returns 200 with empty matches when nothing in the room matches', async () => {
    const room = createChatRoom({ name: 'x', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello world' });
    const response = await callGet(room.id, '?q=banana');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matches).toEqual([]);
  });

  it('returns flat match rows newest-first scoped to the room', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'first pizza' });
    postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'other room pizza' });
    postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'second pizza' });

    const response = await callGet(roomA.id, '?q=pizza');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matches).toHaveLength(2);
    expect(body.matches[0]).toMatchObject({
      body: 'second pizza',
      authorHandle: '@you'
    });
    expect(body.matches[0]).toHaveProperty('id');
    expect(body.matches[0]).toHaveProperty('postedAt');
    expect(body.matches[0]).toHaveProperty('postOrder');
    expect(body.matches[1].body).toBe('first pizza');
    // Should NOT include the roomB hit.
    expect(body.matches.find((m: { body: string }) => m.body === 'other room pizza')).toBeUndefined();
  });

  it('honours a small explicit limit', async () => {
    const room = createChatRoom({ name: 'few', whoCreatedIt: '@you' });
    for (let index = 0; index < 10; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const response = await callGet(room.id, '?q=match&limit=4');
    const body = await response.json();
    expect(body.matches).toHaveLength(4);
  });

  it('caps an absurd limit at 200', async () => {
    const room = createChatRoom({ name: 'lots', whoCreatedIt: '@you' });
    for (let index = 0; index < 250; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const response = await callGet(room.id, '?q=match&limit=99999');
    const body = await response.json();
    expect(body.matches.length).toBeLessThanOrEqual(200);
  });

  it('case-insensitive substring match', async () => {
    const room = createChatRoom({ name: 'ci', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'Let us ship FRESH ant build' });
    const response = await callGet(room.id, '?q=fresh%20ant');
    const body = await response.json();
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].body).toContain('FRESH ant');
  });
});
