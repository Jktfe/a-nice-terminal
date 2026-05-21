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
import { getIdentityDb } from '$lib/server/db';

function callGet(query: Record<string, string>): Promise<Response> {
  const url = new URL(
    `http://localhost/api/status/chasing?${new URLSearchParams(query).toString()}`
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

function ageMessageByMinutes(messageId: string, minutes: number): void {
  const olderIso = new Date(Date.now() - minutes * 60_000).toISOString();
  getIdentityDb()
    .prepare(`UPDATE chat_messages SET posted_at = ? WHERE id = ?`)
    .run(olderIso, messageId);
}

describe('GET /api/status/chasing', () => {
  beforeEach(() => {
    resetChatMessageStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('200 returns idle-trailing threads where I am the most recent author', async () => {
    const room = createChatRoom({ name: 'r-chase', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    postMessage({ roomId: room.id, authorHandle: '@codex', body: 'go on' });
    const mine = postMessage({ roomId: room.id, authorHandle: '@me', body: 'awaiting' });
    ageMessageByMinutes(mine.id, 45);
    const response = await callGet({ handle: '@me', 'min-idle-minutes': '30' });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages.map((m: { id: string }) => m.id)).toEqual([mine.id]);
  });

  it('200 returns empty when threads are still fresh', async () => {
    const room = createChatRoom({ name: 'r-fresh', whoCreatedIt: '@me' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    postMessage({ roomId: room.id, authorHandle: '@codex', body: 'go on' });
    postMessage({ roomId: room.id, authorHandle: '@me', body: 'just spoke' });
    const response = await callGet({ handle: '@me', 'min-idle-minutes': '30' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
  });

  it('400 when handle is missing', async () => {
    const response = await callGet({});
    expect(response.status).toBe(400);
  });

  it('400 when min-idle-minutes is negative', async () => {
    const response = await callGet({ handle: '@me', 'min-idle-minutes': '-5' });
    expect(response.status).toBe(400);
  });
});
