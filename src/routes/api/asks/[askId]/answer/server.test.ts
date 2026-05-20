import { beforeEach, describe, expect, it } from 'vitest';
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

type CallPostOptions = { askId: string; body?: string };

async function callPost(options: CallPostOptions): Promise<Response> {
  const url = `http://localhost/api/asks/${options.askId}/answer`;
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

describe('POST /api/asks/:askId/answer', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetAskStoreForTests();
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
