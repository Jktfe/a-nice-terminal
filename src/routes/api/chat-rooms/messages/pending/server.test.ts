import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';

function callGet(query: Record<string, string>): Promise<Response> {
  const url = new URL(
    `http://localhost/api/chat-rooms/messages/pending?${new URLSearchParams(query).toString()}`
  );
  const event = {
    request: new Request(url.toString()),
    params: {},
    url
  } as unknown as Parameters<typeof GET>[0];
  return Promise.resolve()
    .then(() => GET(event) as Response | Promise<Response>)
    .catch((thrown) => {
      if (thrown instanceof Response) return thrown;
      const failure = thrown as { status?: number; body?: { message?: string } };
      if (typeof failure?.status === 'number') {
        return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
      }
      throw thrown;
    });
}

describe('GET /api/chat-rooms/messages/pending', () => {
  beforeEach(() => {
    resetChatMessageStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('200 returns pending mentions in post_order ASC', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    const first = postMessage({ roomId: room.id, authorHandle: '@codex', body: '@me first' });
    const second = postMessage({ roomId: room.id, authorHandle: '@codex', body: '@me second' });
    const response = await callGet({ handle: '@me' });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages.map((m: { id: string }) => m.id)).toEqual([first.id, second.id]);
  });

  it('200 returns empty list when nothing matches', async () => {
    createChatRoom({ name: 'r-empty', whoCreatedIt: '@me' });
    const response = await callGet({ handle: '@me' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
  });

  it('400 when handle is missing', async () => {
    const response = await callGet({});
    expect(response.status).toBe(400);
  });

  it('400 when since is not numeric', async () => {
    const response = await callGet({ handle: '@me', since: 'NaNN' });
    expect(response.status).toBe(400);
  });
});
