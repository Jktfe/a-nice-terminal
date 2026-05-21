/**
 * Endpoint tests for POST + GET /api/chat-rooms/:roomId/typing.
 * Backs M19 typing-indicator slice 1.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { listActiveTypersInRoom } from '$lib/server/typingIndicatorStore';
import { resetTypingIndicatorStoreForTests } from '$lib/server/typingIndicatorStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): typing POST now requires
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'typing-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type CallOptions = {
  roomId: string;
  body?: string;
  withAuth?: boolean;
};

async function callPost(options: CallOptions): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.withAuth !== false) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request('http://localhost/api/chat-rooms/x/typing', {
    method: 'POST',
    headers,
    body: options.body
  });
  const event = {
    request,
    params: { roomId: options.roomId },
    url: new URL('http://localhost/api/chat-rooms/x/typing')
  } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

async function callGet(roomId: string): Promise<Response> {
  const request = new Request(`http://localhost/api/chat-rooms/${roomId}/typing`);
  const event = {
    request,
    params: { roomId },
    url: new URL(`http://localhost/api/chat-rooms/${roomId}/typing`)
  } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('POST + GET /api/chat-rooms/:roomId/typing', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetTypingIndicatorStoreForTests();
  });

  it('POST records a heartbeat and GET surfaces the active typer', async () => {
    const room = createChatRoom({ name: 'typing-room', whoCreatedIt: '@you' });
    const postResponse = await callPost({
      roomId: room.id,
      body: JSON.stringify({ memberHandle: '@you' })
    });
    expect(postResponse.status).toBe(201);

    const getResponse = await callGet(room.id);
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.activeTypers).toHaveLength(1);
    expect(getBody.activeTypers[0].memberHandle).toBe('@you');
  });

  it('POST returns 404 when the room id is unknown', async () => {
    const response = await callPost({
      roomId: 'does_not_exist',
      body: JSON.stringify({ memberHandle: '@you' })
    });
    expect(response.status).toBe(404);
  });

  it('GET returns 404 when the room id is unknown', async () => {
    const response = await callGet('does_not_exist');
    expect(response.status).toBe(404);
  });

  it('POST returns 400 when memberHandle is missing', async () => {
    const room = createChatRoom({ name: 'no-handle', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({})
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when the body is empty', async () => {
    const room = createChatRoom({ name: 'empty-body', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: '' });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when the body is malformed JSON', async () => {
    const room = createChatRoom({ name: 'malformed', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: '{ not valid' });
    expect(response.status).toBe(400);
  });

  it('GET returns an empty activeTypers array when no heartbeats have landed', async () => {
    const room = createChatRoom({ name: 'no-heartbeats', whoCreatedIt: '@you' });
    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.activeTypers).toEqual([]);
  });

  it('POST returns 404 when the member handle is not in the room and records nothing', async () => {
    const room = createChatRoom({ name: 'member-check', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ memberHandle: '@stranger' })
    });
    expect(response.status).toBe(404);
    expect(listActiveTypersInRoom(room.id)).toEqual([]);
  });

  it('POST accepts an invited member, with or without @ prefix, and records the heartbeat', async () => {
    const room = createChatRoom({ name: 'invited-member', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });

    const withAtPrefix = await callPost({
      roomId: room.id,
      body: JSON.stringify({ memberHandle: '@kimi' })
    });
    expect(withAtPrefix.status).toBe(201);

    const withoutAtPrefix = await callPost({
      roomId: room.id,
      body: JSON.stringify({ memberHandle: 'kimi' })
    });
    expect(withoutAtPrefix.status).toBe(201);

    const typers = listActiveTypersInRoom(room.id);
    expect(typers.some((t) => t.memberHandle === '@kimi')).toBe(true);
  });

  it('POST returns 400 when the body is a JSON array (typeof object trap)', async () => {
    const room = createChatRoom({ name: 'array-body', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: JSON.stringify(['nope']) });
    expect(response.status).toBe(400);
    expect(listActiveTypersInRoom(room.id)).toEqual([]);
  });

  it('POST returns 400 when the body is a JSON non-object (number, string)', async () => {
    const room = createChatRoom({ name: 'number-body', whoCreatedIt: '@you' });
    const responseForNumber = await callPost({ roomId: room.id, body: '42' });
    expect(responseForNumber.status).toBe(400);

    const responseForString = await callPost({ roomId: room.id, body: '"plain-string"' });
    expect(responseForString.status).toBe(400);

    expect(listActiveTypersInRoom(room.id)).toEqual([]);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-typing', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ memberHandle: '@you' }),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(listActiveTypersInRoom(room.id)).toEqual([]);
  });
});
