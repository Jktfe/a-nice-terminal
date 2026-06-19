import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  postBreakMessage,
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';

const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'room-search-test-admin-token';

async function callGet(
  roomId: string,
  rawQs: string,
  token: string | null = ADMIN_TOKEN
): Promise<Response> {
  const fullUrl = new URL(`http://localhost/api/chat-rooms/${roomId}/search${rawQs}`);
  const headers = new Headers();
  if (token !== null) {
    headers.set('authorization', `Bearer ${token}`);
  }
  const event = {
    request: new Request(fullUrl, { headers }),
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
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterAll(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
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

  it('returns 401 for a valid room search without a readable-room identity', async () => {
    const room = createChatRoom({ name: 'private', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'secret banana' });
    const response = await callGet(room.id, '?q=banana', null);
    expect(response.status).toBe(401);
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

  it('defaults room search to the current block after the latest break', async () => {
    const room = createChatRoom({ name: 'current-block', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'blockword before break' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'new section' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'blockword after break' });

    const response = await callGet(room.id, '?q=blockword');
    const body = await response.json();

    expect(body.matches.map((match: { body: string }) => match.body)).toEqual([
      'blockword after break'
    ]);
    expect(body.allContent).toBe(false);
  });

  it('returns full room history when allContent is explicitly enabled', async () => {
    const room = createChatRoom({ name: 'all-content', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'allword before break' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'new section' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'allword after break' });

    const response = await callGet(room.id, '?q=allword&allContent=1');
    const body = await response.json();

    expect(body.matches.map((match: { body: string }) => match.body)).toEqual([
      'allword after break',
      'allword before break'
    ]);
    expect(body.allContent).toBe(true);
  });
});
