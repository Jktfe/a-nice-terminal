/**
 * Endpoint tests for POST /api/chat-rooms/:roomId/breaks.
 *
 * Focuses on the contract: a context break is irreversible, so malformed input
 * must never silently create one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { DELETE } from './[breakId]/+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  getMessageById,
  listMessagesInRoom,
  postBreakMessage,
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): breaks POST now requires
// chatRoomAuthGate. Tests supply admin Bearer by default; the 401-unauth case
// has its own dedicated coverage.
const ADMIN_TOKEN_FOR_TESTS = 'breaks-route-test-admin-token';
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
  contentType?: string;
  withAuth?: boolean;
};

async function callBreaksPost(options: CallOptions): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': options.contentType ?? 'application/json'
  };
  if (options.withAuth !== false) {
    headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  }
  const request = new Request('http://localhost/api/chat-rooms/x/breaks', {
    method: 'POST',
    headers,
    body: options.body
  });
  const event = {
    request,
    params: { roomId: options.roomId },
    url: new URL('http://localhost/api/chat-rooms/x/breaks')
  } as unknown as Parameters<typeof POST>[0];

  try {
    return (await POST(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

type DeleteCallOptions = {
  roomId: string;
  breakId: string;
  withAuth?: boolean;
};

async function callBreakDelete(options: DeleteCallOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.withAuth !== false) {
    headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  }
  const request = new Request(
    `http://localhost/api/chat-rooms/${options.roomId}/breaks/${options.breakId}`,
    { method: 'DELETE', headers }
  );
  const event = {
    request,
    params: { roomId: options.roomId, breakId: options.breakId },
    url: new URL(`http://localhost/api/chat-rooms/${options.roomId}/breaks/${options.breakId}`)
  } as unknown as Parameters<typeof DELETE>[0];

  try {
    return (await DELETE(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('POST /api/chat-rooms/:roomId/breaks', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('returns 201 and creates a break when given a valid JSON body with a reason', async () => {
    const room = createChatRoom({ name: 'reason-room', whoCreatedIt: '@you' });
    const response = await callBreaksPost({
      roomId: room.id,
      body: JSON.stringify({ reason: 'switching tracks', postedByHandle: '@evolveantclaude' })
    });
    expect(response.status).toBe(201);
    const messages = listMessagesInRoom(room.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('system-break');
    expect(messages[0].body).toContain('switching tracks');
  });

  it('attributes admin-authored breaks to @admin instead of trusting postedByHandle', async () => {
    const room = createChatRoom({ name: 'spoofed-break', whoCreatedIt: '@you' });
    const response = await callBreaksPost({
      roomId: room.id,
      body: JSON.stringify({
        reason: 'FlowDeck chat stream delete probe',
        postedByHandle: '@jamesK'
      })
    });

    expect(response.status).toBe(201);
    const messages = listMessagesInRoom(room.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('Context break by @admin');
    expect(messages[0].body).not.toContain('@jamesK');
  });

  it('returns 201 and uses defaults when given an empty body', async () => {
    const room = createChatRoom({ name: 'empty-body', whoCreatedIt: '@you' });
    const response = await callBreaksPost({ roomId: room.id, body: '' });
    expect(response.status).toBe(201);
    const messages = listMessagesInRoom(room.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('system-break');
  });

  it('returns 201 and uses defaults when given an empty JSON object', async () => {
    const room = createChatRoom({ name: 'empty-object', whoCreatedIt: '@you' });
    const response = await callBreaksPost({ roomId: room.id, body: '{}' });
    expect(response.status).toBe(201);
    expect(listMessagesInRoom(room.id)).toHaveLength(1);
  });

  it('returns 400 and does NOT create a break when the JSON body is malformed', async () => {
    const room = createChatRoom({ name: 'malformed-body', whoCreatedIt: '@you' });
    const response = await callBreaksPost({
      roomId: room.id,
      body: '{ this is not valid json'
    });
    expect(response.status).toBe(400);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('returns 400 when the body parses to a non-object (e.g. a JSON array)', async () => {
    const room = createChatRoom({ name: 'array-body', whoCreatedIt: '@you' });
    const response = await callBreaksPost({
      roomId: room.id,
      body: JSON.stringify(['nope'])
    });
    expect(response.status).toBe(400);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('returns 404 when the room id is unknown', async () => {
    const response = await callBreaksPost({
      roomId: 'does_not_exist',
      body: JSON.stringify({ reason: 'no room' })
    });
    expect(response.status).toBe(404);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-break', whoCreatedIt: '@you' });
    const response = await callBreaksPost({
      roomId: room.id,
      body: JSON.stringify({ reason: 'should not land' }),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });
});

describe('DELETE /api/chat-rooms/:roomId/breaks/:breakId', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('soft-deletes a break message for an authenticated room mutator', async () => {
    const room = createChatRoom({ name: 'delete-break', whoCreatedIt: '@you' });
    const breakMessage = postBreakMessage({
      roomId: room.id,
      postedByHandle: '@you',
      reason: 'mistaken break'
    });

    const response = await callBreakDelete({ roomId: room.id, breakId: breakMessage.id });

    expect(response.status).toBe(204);
    const updated = getMessageById(breakMessage.id);
    expect(updated?.kind).toBe('system-break');
    expect(updated?.deletedAtMs).toEqual(expect.any(Number));
    expect(updated?.deletedByHandle).toBe('@admin');
  });

  it('returns 401 and leaves the break untouched when no auth is provided', async () => {
    const room = createChatRoom({ name: 'delete-break-unauth', whoCreatedIt: '@you' });
    const breakMessage = postBreakMessage({ roomId: room.id, postedByHandle: '@you' });

    const response = await callBreakDelete({
      roomId: room.id,
      breakId: breakMessage.id,
      withAuth: false
    });

    expect(response.status).toBe(401);
    expect(getMessageById(breakMessage.id)?.deletedAtMs).toBeUndefined();
  });

  it('returns 404 and does not delete a normal message through the break endpoint', async () => {
    const room = createChatRoom({ name: 'delete-non-break', whoCreatedIt: '@you' });
    const normalMessage = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'not a break'
    });

    const response = await callBreakDelete({ roomId: room.id, breakId: normalMessage.id });

    expect(response.status).toBe(404);
    expect(getMessageById(normalMessage.id)?.deletedAtMs).toBeUndefined();
  });
});
