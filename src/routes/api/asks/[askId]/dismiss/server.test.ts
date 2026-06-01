import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  answerAsk,
  findAskById,
  openAskInRoom,
  resetAskStoreForTests,
  type Ask
} from '$lib/server/askStore';

type CallPostOptions = { askId: string; body?: string };

async function callPost(options: CallPostOptions): Promise<Response> {
  const url = `http://localhost/api/asks/${options.askId}/dismiss`;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

describe('POST /api/asks/:askId/dismiss', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetAskStoreForTests();
  });

  it('200 when a room member dismisses an open ask', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ dismissedByHandle: '@you' })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ask.status).toBe('dismissed');
    expect(body.ask.dismissedByHandle).toBe('@you');
  });

  it('404 when the askId is unknown', async () => {
    const response = await callPost({
      askId: 'no_such_ask',
      body: JSON.stringify({ dismissedByHandle: '@you' })
    });
    expect(response.status).toBe(404);
  });

  it('404 when dismissedByHandle is not a member of the ask room — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ dismissedByHandle: '@stranger' })
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

  it('400 when dismissedByHandle is missing — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({})
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when dismissedByHandle is whitespace-only — ask unchanged', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ dismissedByHandle: '   ' })
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('400 when the ask is already answered — answer preserved', async () => {
    const ask = seedOpenAsk('@you');
    answerAsk({ askId: ask.id, answeredByHandle: '@you', answer: 'first' });
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ dismissedByHandle: '@you' })
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('answered');
  });

  it('400 when the ask is already dismissed', async () => {
    const ask = seedOpenAsk('@you');
    await callPost({
      askId: ask.id,
      body: JSON.stringify({ dismissedByHandle: '@you' })
    });
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ dismissedByHandle: '@you' })
    });
    expect(response.status).toBe(400);
    expect(findAskById(ask.id)?.status).toBe('dismissed');
  });

  it('normalises bare handle to @handle', async () => {
    const ask = seedOpenAsk('@you', '@bob');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ dismissedByHandle: '  bob  ' })
    });
    expect(response.status).toBe(200);
    expect(findAskById(ask.id)?.dismissedByHandle).toBe('@bob');
  });
});
