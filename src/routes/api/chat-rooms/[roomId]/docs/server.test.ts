/**
 * Docs route tests — Task #124 v3-parity.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, PATCH, POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetDocsStoreForTests } from '$lib/server/docsStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): docs POST/PATCH/DELETE now require
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'docs-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  roomId: string,
  search = '',
  body?: unknown,
  withAuth = true
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/docs${search}`);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
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

describe('/api/chat-rooms/:roomId/docs', () => {
  beforeEach(() => {
    resetDocsStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('GET 404s when the room does not exist', async () => {
    const response = await runHandler(GET, eventFor('GET', 'ghost'));
    expect(response.status).toBe(404);
  });

  it('GET returns empty array for room with no docs', async () => {
    const room = createChatRoom({ name: 'docs-test', whoCreatedIt: 'test' });
    const response = await runHandler(GET, eventFor('GET', room.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.docs).toEqual([]);
  });

  it('POST creates a doc and GET lists it', async () => {
    const room = createChatRoom({ name: 'docs-test', whoCreatedIt: 'test' });
    const postRes = await runHandler(POST, eventFor('POST', room.id, '', { title: 'Test Doc', content: '# Hello' }));
    expect(postRes.status).toBe(201);
    const created = await postRes.json();
    expect(created.title).toBe('Test Doc');

    const getRes = await runHandler(GET, eventFor('GET', room.id));
    const body = await getRes.json();
    expect(body.docs.length).toBe(1);
    expect(body.docs[0].title).toBe('Test Doc');
  });

  it('POST rejects missing title', async () => {
    const room = createChatRoom({ name: 'docs-test', whoCreatedIt: 'test' });
    const res = await runHandler(POST, eventFor('POST', room.id, '', { content: 'body only' }));
    expect(res.status).toBe(400);
  });

  it('PATCH updates a doc', async () => {
    const room = createChatRoom({ name: 'docs-test', whoCreatedIt: 'test' });
    const postRes = await runHandler(POST, eventFor('POST', room.id, '', { title: 'Old', content: 'body' }));
    const created = await postRes.json();

    const patchRes = await runHandler(PATCH, eventFor('PATCH', room.id, `?docId=${created.id}`, { title: 'New' }));
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.title).toBe('New');
  });

  it('DELETE soft-deletes a doc', async () => {
    const room = createChatRoom({ name: 'docs-test', whoCreatedIt: 'test' });
    const postRes = await runHandler(POST, eventFor('POST', room.id, '', { title: 'ToDelete' }));
    const created = await postRes.json();

    const delRes = await runHandler(DELETE, eventFor('DELETE', room.id, `?docId=${created.id}`));
    expect(delRes.status).toBe(204);

    const getRes = await runHandler(GET, eventFor('GET', room.id));
    const body = await getRes.json();
    expect(body.docs).toEqual([]);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-doc', whoCreatedIt: 'test' });
    const res = await runHandler(
      POST,
      eventFor('POST', room.id, '', { title: 'nope' }, false)
    );
    expect(res.status).toBe(401);
  });

  it('PATCH returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-doc-patch', whoCreatedIt: 'test' });
    const res = await runHandler(
      PATCH,
      eventFor('PATCH', room.id, '?docId=d_x', { title: 'nope' }, false)
    );
    expect(res.status).toBe(401);
  });

  it('DELETE returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-doc-del', whoCreatedIt: 'test' });
    const res = await runHandler(
      DELETE,
      eventFor('DELETE', room.id, '?docId=d_x', undefined, false)
    );
    expect(res.status).toBe(401);
  });
});
