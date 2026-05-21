import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATCH } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests,
  findChatRoomById
} from '$lib/server/chatRoomStore';
import {
  listMessagesInRoom,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';

// LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): PATCH now requires
// chatRoomAuthGate. Set ANT_ADMIN_TOKEN before each test and supply an
// admin Bearer so the rename happy paths keep passing. 401-unauth coverage
// is in the dedicated security spec below.
const ADMIN_TOKEN_FOR_TESTS = 'name-route-test-admin-token';
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

async function callPatch(options: CallOptions): Promise<Response> {
  const withAuth = options.withAuth !== false;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request('http://localhost/api/chat-rooms/x/name', {
    method: 'PATCH',
    headers,
    body: options.body
  });
  const event = {
    request,
    params: { roomId: options.roomId },
    url: new URL('http://localhost/api/chat-rooms/x/name')
  } as unknown as Parameters<typeof PATCH>[0];
  try {
    return (await PATCH(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('PATCH /api/chat-rooms/:roomId/name', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('returns 200 and renames the room when given a valid newName', async () => {
    const room = createChatRoom({ name: 'old name', whoCreatedIt: '@you' });
    const response = await callPatch({
      roomId: room.id,
      body: JSON.stringify({ newName: 'fresh name' })
    });
    expect(response.status).toBe(200);
    expect(findChatRoomById(room.id)?.name).toBe('fresh name');
  });

  it('posts a system message describing the rename', async () => {
    const room = createChatRoom({ name: 'before', whoCreatedIt: '@you' });
    await callPatch({
      roomId: room.id,
      body: JSON.stringify({ newName: 'after' })
    });
    const messages = listMessagesInRoom(room.id);
    const systemMessage = messages.find((m) => m.kind === 'system');
    expect(systemMessage?.body).toContain('before');
    expect(systemMessage?.body).toContain('after');
  });

  it('trims whitespace from the new name', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    await callPatch({
      roomId: room.id,
      body: JSON.stringify({ newName: '   trimmed name   ' })
    });
    expect(findChatRoomById(room.id)?.name).toBe('trimmed name');
  });

  it('returns 400 when newName is missing', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const response = await callPatch({
      roomId: room.id,
      body: JSON.stringify({})
    });
    expect(response.status).toBe(400);
    expect(findChatRoomById(room.id)?.name).toBe('a');
  });

  it('returns 400 when newName is blank', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const response = await callPatch({
      roomId: room.id,
      body: JSON.stringify({ newName: '   ' })
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when newName is not a string', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const response = await callPatch({
      roomId: room.id,
      body: JSON.stringify({ newName: 42 })
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when the body is malformed JSON', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const response = await callPatch({ roomId: room.id, body: '{ not valid' });
    expect(response.status).toBe(400);
  });

  it('returns 400 when the body is a JSON array', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const response = await callPatch({
      roomId: room.id,
      body: JSON.stringify(['nope'])
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when the body is empty', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const response = await callPatch({ roomId: room.id, body: '' });
    expect(response.status).toBe(400);
  });

  it('returns 404 when the room id is unknown and posts no system message', async () => {
    const response = await callPatch({
      roomId: 'does_not_exist',
      body: JSON.stringify({ newName: 'whatever' })
    });
    expect(response.status).toBe(404);
    expect(listMessagesInRoom('does_not_exist')).toHaveLength(0);
  });

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  it('returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'no-auth', whoCreatedIt: '@you' });
    const response = await callPatch({
      roomId: room.id,
      body: JSON.stringify({ newName: 'hijacked' }),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(findChatRoomById(room.id)?.name).toBe('no-auth');
  });
});
