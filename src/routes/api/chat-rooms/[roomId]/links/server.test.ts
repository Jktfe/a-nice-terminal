/**
 * Endpoint tests for /api/chat-rooms/:roomId/links — Task #49 v3 parity.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetChatRoomLinkStoreForTests } from '$lib/server/chatRoomLinkStore';

// LAUNCH-BLOCKER CVE (msg_hodqchn3ek code-review CRITICAL #1, 2026-05-20):
// links POST + DELETE now require chatRoomAuthGate. Tests supply admin
// Bearer in every mutating event (GET still passes through unauthed).
const ADMIN_TOKEN_FOR_TESTS = 'links-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(method: 'GET' | 'POST' | 'DELETE', roomId: string, search = '', body?: unknown) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/links${search}`);
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (method !== 'GET') {
    headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const request = new Request(url.toString(), init);
  return { request, params: { roomId }, url } as unknown as AnyEvent;
}

async function runHandler(handler: (event: AnyEvent) => unknown, event: AnyEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('/api/chat-rooms/:roomId/links', () => {
  beforeEach(() => {
    resetChatRoomLinkStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('GET returns empty outgoing+incoming for a fresh room', async () => {
    const room = createChatRoom({ name: 'alone', whoCreatedIt: '@you' });
    const response = await runHandler(GET, eventFor('GET', room.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ outgoing: [], incoming: [] });
  });

  it('GET 404s for an unknown room', async () => {
    const response = await runHandler(GET, eventFor('GET', 'nope'));
    expect(response.status).toBe(404);
  });

  it('POST creates a link to an existing room and GET reflects it', async () => {
    const source = createChatRoom({ name: 'main', whoCreatedIt: '@you' });
    const target = createChatRoom({ name: 'native', whoCreatedIt: '@you' });
    const postResponse = await runHandler(
      POST,
      eventFor('POST', source.id, '', { targetRoomId: target.id, relationship: 'discussion_of' })
    );
    expect(postResponse.status).toBe(201);
    const created = await postResponse.json();
    expect(created).toMatchObject({
      sourceRoomId: source.id,
      targetRoomId: target.id,
      relationship: 'discussion_of'
    });

    const getResponse = await runHandler(GET, eventFor('GET', source.id));
    const body = await getResponse.json();
    expect(body.outgoing).toHaveLength(1);
    expect(body.outgoing[0]).toMatchObject({ peerRoomId: target.id, peerRoomName: 'native' });
  });

  it('POST rejects self-link with 400', async () => {
    const room = createChatRoom({ name: 'solo', whoCreatedIt: '@you' });
    const response = await runHandler(
      POST,
      eventFor('POST', room.id, '', { targetRoomId: room.id, relationship: 'discussion_of' })
    );
    expect(response.status).toBe(400);
  });

  it('POST 404s when targetRoomId is unknown', async () => {
    const source = createChatRoom({ name: 'main', whoCreatedIt: '@you' });
    const response = await runHandler(
      POST,
      eventFor('POST', source.id, '', { targetRoomId: 'ghost', relationship: 'discussion_of' })
    );
    expect(response.status).toBe(404);
  });

  it('POST rejects duplicate (source, target, relationship) with 409', async () => {
    const source = createChatRoom({ name: 'main', whoCreatedIt: '@you' });
    const target = createChatRoom({ name: 'native', whoCreatedIt: '@you' });
    await runHandler(
      POST,
      eventFor('POST', source.id, '', { targetRoomId: target.id, relationship: 'discussion_of' })
    );
    const dup = await runHandler(
      POST,
      eventFor('POST', source.id, '', { targetRoomId: target.id, relationship: 'discussion_of' })
    );
    expect(dup.status).toBe(409);
  });

  it('POST defaults relationship to discussion_of when omitted', async () => {
    const source = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const target = createChatRoom({ name: 'b', whoCreatedIt: '@you' });
    const response = await runHandler(
      POST,
      eventFor('POST', source.id, '', { targetRoomId: target.id })
    );
    const body = await response.json();
    expect(body.relationship).toBe('discussion_of');
  });

  it('DELETE removes a link by id and returns 204', async () => {
    const source = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const target = createChatRoom({ name: 'b', whoCreatedIt: '@you' });
    const created = await runHandler(
      POST,
      eventFor('POST', source.id, '', { targetRoomId: target.id, relationship: 'follows_up' })
    );
    const { id: linkId } = await created.json();

    const deletion = await runHandler(DELETE, eventFor('DELETE', source.id, `?linkId=${linkId}`));
    expect(deletion.status).toBe(204);

    const after = await runHandler(GET, eventFor('GET', source.id));
    const afterBody = await after.json();
    expect(afterBody.outgoing).toHaveLength(0);
  });

  it('DELETE 400s when linkId is missing', async () => {
    const room = createChatRoom({ name: 'solo', whoCreatedIt: '@you' });
    const response = await runHandler(DELETE, eventFor('DELETE', room.id));
    expect(response.status).toBe(400);
  });
});
