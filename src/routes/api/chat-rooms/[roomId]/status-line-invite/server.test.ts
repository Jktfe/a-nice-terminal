import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { listMessagesInRoom, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'status-line-invite-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
});

async function callPost(roomId: string, withAuth = true): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(`http://localhost/api/chat-rooms/${roomId}/status-line-invite`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cli: 'qwen-cli' })
  });
  const event = {
    request,
    params: { roomId },
    url: new URL(request.url)
  } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: unknown };
    if (typeof failure.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

describe('POST /api/chat-rooms/:roomId/status-line-invite', () => {
  it('posts one system invite with the qwen install command and target handles', async () => {
    const room = createChatRoom({ name: 'status-line room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@speedycodex' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@speedykimi' });

    const response = await callPost(room.id);

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.targetHandles).toEqual(['@speedycodex', '@speedykimi']);
    expect(payload.message.kind).toBe('system');
    expect(payload.message.body).toContain('@everyone');
    expect(payload.message.body).toContain('ant status install-line --cli qwen-cli');
    expect(listMessagesInRoom(room.id)).toHaveLength(1);
  });

  it('returns 404 for unknown rooms and does not create messages', async () => {
    const response = await callPost('missing-room');

    expect(response.status).toBe(404);
    expect(listMessagesInRoom('missing-room')).toHaveLength(0);
  });

  it('requires room read access before broadcasting', async () => {
    const room = createChatRoom({ name: 'locked', whoCreatedIt: '@you' });

    const response = await callPost(room.id, false);

    expect(response.status).toBe(401);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });
});
