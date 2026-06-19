import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'ask-defer-test-admin';

type CallPostOptions = { askId: string; body?: string; authenticated?: boolean };

async function callPost(options: CallPostOptions): Promise<Response> {
  const url = `http://localhost/api/asks/${options.askId}/defer`;
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
    targetHandle: roomCreator,
    title: 't',
    body: 'b'
  });
}

describe('POST /api/asks/:askId/defer', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetChatRoomStoreForTests();
    resetAskStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  it('401 for anonymous defers before mutation', async () => {
    const ask = seedOpenAsk('@you');
    const response = await callPost({
      askId: ask.id,
      body: JSON.stringify({ deferredByHandle: '@you' }),
      authenticated: false
    });
    expect(response.status).toBe(401);
    expect(findAskById(ask.id)?.status).toBe('open');
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
