import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  dismissAsk,
  findAskById,
  openAskInRoom,
  resetAskStoreForTests,
  type Ask
} from '$lib/server/askStore';
import {
  listMessagesInRoom,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import { subscribeRoomEvents } from '$lib/server/eventBroadcast';

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'ask-answer-test-admin';

type CallPostOptions = { askId: string; body?: string; authenticated?: boolean };

async function callPost(options: CallPostOptions): Promise<Response> {
  const url = `http://localhost/api/asks/${options.askId}/answer`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.authenticated !== false) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  const request = new Request(url, {
    method: 'POST',
    headers,
    body: options.body
  });
  const event = {
    request,
    params: { askId: options.askId },
    url: new URL(url)
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

function seedOpenAsk(roomCreator: string = '@you', memberHandle?: string): Ask {
  const room = createChatRoom({ name: 'asks-r', whoCreatedIt: roomCreator });
  if (memberHandle) {
    inviteAgentToRoom({ roomId: room.id, agentHandle: memberHandle });
  }
  return openAskInRoom({
    roomId: room.id,
    openedByHandle: roomCreator,
    title: 't',
    body: 'b'
  });
}

describe('POST /api/asks/:askId/answer', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetChatRoomStoreForTests();
    resetAskStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  it('401 for anonymous answers before mutation or room fanout', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '@you', answer: 'because' }),
      authenticated: false
    });
    expect(response.status).toBe(401);
    expect(findAskById(ask.id)?.status).toBe('open');
    expect(listMessagesInRoom(ask.roomId)).toHaveLength(0);
  });

  it('200 when a room member answers an open ask', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '@you', answer: 'because' })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ask.status).toBe('answered');
    expect(body.ask.answer).toBe('because');
    expect(body.ask.answeredByHandle).toBe('@you');
  });

  it('posts and broadcasts the answer into the originating room', async () => {
    const ask = seedOpenAsk('@you');
    const broadcastEvents: Record<string, unknown>[] = [];
    const unsubscribe = subscribeRoomEvents(ask.roomId, (event) => {
      broadcastEvents.push(event);
    });

    try {
      const response = await callPost({
        askId: ask.id,
        body: JSON.stringify({ answeredByHandle: '@you', answer: 'Because the answer belongs in-room.' })
      });

      expect(response.status).toBe(200);
    } finally {
      unsubscribe();
    }

    const messages = listMessagesInRoom(ask.roomId);
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('system');
    expect(messages[0].authorHandle).toBe('@system');
    expect(messages[0].body).toContain('Open ask answered by @you: t');
    expect(messages[0].body).toContain('Because the answer belongs in-room.');
    expect(broadcastEvents).toHaveLength(1);
    expect(broadcastEvents[0]).toMatchObject({
      type: 'message_added',
      message: messages[0]
    });
  });

  it('404 when the askId is unknown — no mutation', async () => {
    const response = await callPost({
      askId: 'no_such_ask',
      body: JSON.stringify({ answeredByHandle: '@you', answer: 'x' })
    });
    expect(response.status).toBe(404);
  });

  it('404 when the answeredByHandle is not a member of the ask room — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '@stranger', answer: 'x' })
    });
    expect(response.status).toBe(404);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when body is malformed JSON — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({ askId: ask.id, body: '{ broken' });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when body is empty — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({ askId: ask.id, body: '' });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when body is a JSON array — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify(['nope'])
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when answeredByHandle is missing — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answer: 'x' })
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when answer is missing — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '@you' })
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when answer is whitespace-only — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '@you', answer: '   ' })
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when the ask is already answered — first answer preserved', async () => {
    const ask = seedOpenAsk('@you');
    await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '@you', answer: 'first' })
    });
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '@you', answer: 'second' })
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.answer).toBe('first');
  });

  it('400 when the ask is already dismissed', async () => {
    const ask = seedOpenAsk('@you');
    dismissAsk({ askId: ask.id, dismissedByHandle: '@you' });
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '@you', answer: 'x' })
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('dismissed');
  });

  it('normalises bare handle to @handle', async () => {
    const ask = seedOpenAsk('@you', '@bob');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ answeredByHandle: '  bob  ', answer: 'x' })
    });
    expect(response.status).toBe(200);
    expect(findAskById(ask.id)?.answeredByHandle).toBe('@bob');
  });
});
