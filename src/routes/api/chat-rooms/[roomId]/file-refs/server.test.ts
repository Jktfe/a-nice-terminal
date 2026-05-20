import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetChatRoomFileRefStoreForTests } from '$lib/server/chatRoomFileRefStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): file-refs POST/DELETE now require
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'file-refs-route-test-admin-token';
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
  method: 'GET' | 'POST' | 'DELETE',
  roomId: string,
  search = '',
  body?: unknown,
  withAuth = true
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/file-refs${search}`);
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

describe('/api/chat-rooms/:roomId/file-refs', () => {
  beforeEach(() => {
    resetChatRoomFileRefStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('GET 404s for an unknown room', async () => {
    const response = await runHandler(GET, eventFor('GET', 'ghost'));
    expect(response.status).toBe(404);
  });

  it('GET returns an empty list for a fresh room', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await runHandler(GET, eventFor('GET', room.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileRefs: [] });
  });

  it('POST creates a ref and GET reflects it newest-first', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const first = await runHandler(
      POST,
      eventFor('POST', room.id, '', { filePath: 'src/app.html', note: 'viewport meta', flaggedBy: '@you' })
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ filePath: 'src/app.html', note: 'viewport meta', flaggedBy: '@you' });

    const list = await runHandler(GET, eventFor('GET', room.id));
    const listBody = await list.json();
    expect(listBody.fileRefs).toHaveLength(1);
    expect(listBody.fileRefs[0].id).toBe(firstBody.id);
  });

  it('POST 400s when filePath is missing or blank', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const blank = await runHandler(POST, eventFor('POST', room.id, '', { filePath: '   ' }));
    expect(blank.status).toBe(400);
    const missing = await runHandler(POST, eventFor('POST', room.id, '', { note: 'oops' }));
    expect(missing.status).toBe(400);
  });

  it('DELETE soft-deletes by fileRefId and 404s on second attempt', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const create = await runHandler(
      POST,
      eventFor('POST', room.id, '', { filePath: 'README.md' })
    );
    const created = await create.json();
    const remove = await runHandler(DELETE, eventFor('DELETE', room.id, `?fileRefId=${created.id}`));
    expect(remove.status).toBe(204);
    const removeAgain = await runHandler(DELETE, eventFor('DELETE', room.id, `?fileRefId=${created.id}`));
    expect(removeAgain.status).toBe(404);
  });

  it('DELETE 400s when fileRefId missing', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await runHandler(DELETE, eventFor('DELETE', room.id));
    expect(response.status).toBe(400);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-file-ref', whoCreatedIt: '@you' });
    const response = await runHandler(
      POST,
      eventFor('POST', room.id, '', { filePath: 'src/x.ts' }, false)
    );
    expect(response.status).toBe(401);
  });

  it('DELETE returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-file-ref-del', whoCreatedIt: '@you' });
    const response = await runHandler(
      DELETE,
      eventFor('DELETE', room.id, '?fileRefId=fr_x', undefined, false)
    );
    expect(response.status).toBe(401);
  });
});
