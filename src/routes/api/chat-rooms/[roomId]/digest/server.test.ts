/**
 * Endpoint tests for GET /api/chat-rooms/:roomId/digest.
 *
 * Pure statistical digest of the room's chat_messages — no LLM.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';

function postMessageWithBody(roomId: string, authorHandle: string, body: string) {
  return postMessage({ roomId, authorHandle, body });
}

function eventFor(roomId: string) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/digest`);
  const request = new Request(url.toString(), { method: 'GET' });
  return { request, params: { roomId }, url } as unknown as Parameters<typeof GET>[0];
}

async function runHandler(roomId: string): Promise<Response> {
  try {
    return (await GET(eventFor(roomId))) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('GET /api/chat-rooms/:roomId/digest', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('404s for a room that does not exist', async () => {
    const response = await runHandler('does-not-exist');
    expect(response.status).toBe(404);
  });

  it('returns zero-totals shape when the room is empty', async () => {
    const room = createChatRoom({ name: 'quiet', whoCreatedIt: '@you' });
    const response = await runHandler(room.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      messageCount: 0,
      participantCount: 0,
      durationMinutes: 0,
      messagesPerHour: 0,
      participants: [],
      keyTerms: [],
      firstMessage: null,
      lastMessage: null
    });
  });

  it('aggregates participants, totals, and key terms from posted messages', async () => {
    const room = createChatRoom({ name: 'busy', whoCreatedIt: '@you' });
    postMessageWithBody(room.id, '@alice', 'rocket engine telemetry shows nominal thrust nominal thrust');
    postMessageWithBody(room.id, '@bob', 'telemetry confirmed by ground team');
    postMessageWithBody(room.id, '@alice', 'ground team confirms — switching to crew comms');

    const response = await runHandler(room.id);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.messageCount).toBe(3);
    expect(body.participantCount).toBe(2);
    expect(typeof body.durationMinutes).toBe('number');
    expect(body.durationMinutes).toBeGreaterThanOrEqual(0);
    expect(typeof body.messagesPerHour).toBe('number');

    expect(body.participants[0]).toMatchObject({ id: '@alice', count: 2 });
    expect(body.participants[1]).toMatchObject({ id: '@bob', count: 1 });

    const terms = body.keyTerms.map((entry: { term: string }) => entry.term);
    expect(terms).toContain('telemetry');
    expect(terms).toContain('ground');
    expect(terms).not.toContain('the');
  });
});
