import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  findAskById,
  hasResponseRequiredAsksForHandle,
  openAskInRoom,
  resetAskStoreForTests,
  type Ask
} from '$lib/server/askStore';

type CallPostOptions = { askId: string; body?: string };

async function callPost(options: CallPostOptions): Promise<Response> {
  const url = `http://localhost/api/asks/${options.askId}/defer`;
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
    targetHandle: roomCreator,
    title: 't',
    body: 'b'
  });
}

describe('POST /api/asks/:askId/defer', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetAskStoreForTests();
  });

  it('200 when a room member defers an open ask and keeps it response-required', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ deferredByHandle: '@you' })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ask.status).toBe('deferred');
    expect(findAskById(ask.id)?.status).toBe('deferred');
    expect(hasResponseRequiredAsksForHandle('@you')).toBe(true);
  });
});
