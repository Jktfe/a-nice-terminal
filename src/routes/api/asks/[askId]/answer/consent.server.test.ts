import { beforeEach, describe, expect, it } from 'vitest';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createConsentGrant, resetConsentGrantStoreForTests } from '$lib/server/consentGrantStore';
import { findAskById, openAskInRoom, resetAskStoreForTests } from '$lib/server/askStore';
import { POST } from './+server';

beforeEach(() => {
  resetChatRoomStoreForTests();
  resetAskStoreForTests();
  resetConsentGrantStoreForTests();
});

async function callPost(askId: string, body: unknown): Promise<Response> {
  const url = `http://localhost/api/asks/${askId}/answer`;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const event = { request, params: { askId }, url: new URL(url) } as unknown as Parameters<typeof POST>[0];
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

describe('POST /api/asks/:askId/answer consent gate', () => {
  it('returns 403 and leaves the ask open when a declared consent topic has no grant', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const ask = openAskInRoom({ roomId: room.id, openedByHandle: '@you', title: 't', body: 'b' });
    const response = await callPost(ask.id, {
      answeredByHandle: '@you',
      answer: 'sensitive answer',
      consentTopic: 'file-read',
      consentSource: '/tmp/a.txt'
    });
    expect(response.status).toBe(403);
    expect(findAskById(ask.id)?.status).toBe('open');
  });

  it('consumes a matching consent grant before answering', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const ask = openAskInRoom({ roomId: room.id, openedByHandle: '@you', title: 't', body: 'b' });
    const grant = createConsentGrant({
      roomId: room.id,
      grantedTo: '@you',
      topic: 'file-read',
      sourceSet: ['/tmp/a.txt'],
      maxAnswers: 1
    });

    const response = await callPost(ask.id, {
      answeredByHandle: '@you',
      answer: 'sensitive answer',
      consentTopic: 'file-read',
      consentSource: '/tmp/a.txt'
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ask.status).toBe('answered');
    expect(body.consent).toMatchObject({ grantId: grant.id, status: 'exhausted' });
  });
});
