import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST, DELETE } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import {
  listReactionsForMessage,
  resetMessageReactionStoreForTests
} from '$lib/server/messageReactionStore';
import { resetAskStoreForTests } from '$lib/server/askStore';
import { listOpenAskCandidates } from '$lib/server/askCandidateStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): reactions POST/DELETE now require
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'reactions-route-test-admin-token';
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
  messageId: string;
  body?: string;
  withAuth?: boolean;
};

function buildEvent<T extends typeof POST>(
  url: string,
  method: 'POST' | 'GET' | 'DELETE',
  roomId: string,
  messageId: string,
  body?: string,
  withAuth = true
): Parameters<T>[0] {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(url, { method, headers, body });
  return {
    request,
    params: { roomId, messageId },
    url: new URL(url)
  } as unknown as Parameters<T>[0];
}

async function asResponse(
  produceResponse: () => Response | Promise<Response> | unknown
): Promise<Response> {
  try {
    return (await produceResponse()) as Response;
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

async function callPost(options: CallOptions): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${options.roomId}/messages/${options.messageId}/reactions`;
  return asResponse(() =>
    POST(
      buildEvent(
        url,
        'POST',
        options.roomId,
        options.messageId,
        options.body,
        options.withAuth !== false
      )
    )
  );
}
async function callDelete(options: CallOptions): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${options.roomId}/messages/${options.messageId}/reactions`;
  return asResponse(() =>
    DELETE(
      buildEvent(
        url,
        'DELETE',
        options.roomId,
        options.messageId,
        options.body,
        options.withAuth !== false
      )
    )
  );
}
async function callGet(roomId: string, messageId: string): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/messages/${messageId}/reactions`;
  return asResponse(() => GET(buildEvent(url, 'GET', roomId, messageId)));
}

describe('POST + DELETE + GET reactions', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetMessageReactionStoreForTests();
    resetAskStoreForTests();
  });

  it('POST records a reaction and GET lists it', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'hello'
    });

    const postResponse = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '👍' })
    });
    expect(postResponse.status).toBe(201);

    const getResponse = await callGet(room.id, message.id);
    const body = await getResponse.json();
    expect(body.reactions).toHaveLength(1);
    expect(body.reactions[0].emoji).toBe('👍');
    expect(body.reactions[0].reactorHandle).toBe('@kimi');
  });

  it('POST is idempotent for the same (reactor, emoji) on the same message', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '👍' })
    });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '👍' })
    });
    expect(listReactionsForMessage(message.id)).toHaveLength(1);
  });

  it('POST allows the same reactor to add multiple emojis to one message', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '👍' })
    });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '🙌' })
    });
    expect(listReactionsForMessage(message.id)).toHaveLength(2);
  });

  it('POST creates an ask candidate for hands-up reactions', async () => {
    const room = createChatRoom({ name: 'candidate-reaction', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'needs decision' });

    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '🙋‍♂️' })
    });

    expect(response.status).toBe(201);
    expect(listOpenAskCandidates(room.id)).toHaveLength(1);
    expect(listOpenAskCandidates(room.id)[0]).toMatchObject({
      sourceType: 'reaction',
      sourceActorHandle: '@kimi',
      sourceEmoji: '🙋‍♂️'
    });
  });

  it('POST normalises a bare handle to @handle', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@bob' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '  bob  ', emoji: '👍' })
    });
    expect(response.status).toBe(201);
    expect(listReactionsForMessage(message.id)[0].reactorHandle).toBe('@bob');
  });

  it('POST returns 404 when the room is unknown', async () => {
    const response = await callPost({
      roomId: 'nope',
      messageId: 'msg_x',
      body: JSON.stringify({ reactorHandle: '@you', emoji: '👍' })
    });
    expect(response.status).toBe(404);
  });

  it('POST returns 404 when the message is not in this room', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: roomB.id, agentHandle: '@kimi' });
    const messageInA = postMessage({
      roomId: roomA.id,
      authorHandle: '@you',
      body: 'secret'
    });
    const response = await callPost({
      roomId: roomB.id,
      messageId: messageInA.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '👍' })
    });
    expect(response.status).toBe(404);
    expect(listReactionsForMessage(messageInA.id)).toEqual([]);
  });

  it('POST returns 404 when reactor is not a member', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@stranger', emoji: '👍' })
    });
    expect(response.status).toBe(404);
  });

  it('POST returns 400 when reactorHandle is missing', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ emoji: '👍' })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when emoji is missing (after membership check)', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@a' })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when emoji is whitespace-only', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@a', emoji: '   ' })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is malformed JSON', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: '{ broken'
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is a JSON array', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify(['nope'])
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is empty', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: ''
    });
    expect(response.status).toBe(400);
  });

  it('DELETE returns wasReactionThere=true when the reaction existed', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@a', emoji: '👍' })
    });
    const response = await callDelete({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@a', emoji: '👍' })
    });
    const body = await response.json();
    expect(body.wasReactionThere).toBe(true);
    expect(listReactionsForMessage(message.id)).toEqual([]);
  });

  it('DELETE returns wasReactionThere=false when nothing to delete', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callDelete({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@a', emoji: '👍' })
    });
    const body = await response.json();
    expect(body.wasReactionThere).toBe(false);
  });

  it('DELETE returns 404 when reactor is not a member', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callDelete({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@stranger', emoji: '👍' })
    });
    expect(response.status).toBe(404);
  });

  it('GET returns 404 when room is unknown', async () => {
    const response = await callGet('nope', 'msg_x');
    expect(response.status).toBe(404);
  });

  it('GET returns 404 when message is not in this room', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: roomA.id,
      authorHandle: '@you',
      body: 'hi'
    });
    const response = await callGet(roomB.id, message.id);
    expect(response.status).toBe(404);
  });

  it('GET returns empty when no reactions', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callGet(room.id, message.id);
    const body = await response.json();
    expect(body.reactions).toEqual([]);
  });

  it('GET returns reactions in add-order across reactors', async () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@one' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@two' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@one', emoji: '👍' })
    });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@two', emoji: '🙌' })
    });
    const response = await callGet(room.id, message.id);
    const body = await response.json();
    expect(body.reactions.map((entry: { reactorHandle: string }) => entry.reactorHandle)).toEqual([
      '@one',
      '@two'
    ]);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-reaction', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    const response = await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '👍' }),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(listReactionsForMessage(message.id)).toEqual([]);
  });

  it('DELETE returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-reaction-del', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi' });
    await callPost({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '👍' })
    });
    const response = await callDelete({
      roomId: room.id,
      messageId: message.id,
      body: JSON.stringify({ reactorHandle: '@kimi', emoji: '👍' }),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(listReactionsForMessage(message.id)).toHaveLength(1);
  });
});
