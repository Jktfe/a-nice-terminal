import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, PATCH, POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetTerminalPromptEventStoreForTests } from '$lib/server/terminalPromptEventStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): prompts POST/PATCH now require
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'prompts-route-test-admin-token';
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
  method: 'GET' | 'POST' | 'PATCH',
  roomId: string,
  search = '',
  body?: unknown,
  withAuth = true
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/prompts${search}`);
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

describe('/api/chat-rooms/:roomId/prompts', () => {
  beforeEach(() => {
    resetTerminalPromptEventStoreForTests();
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
    expect(await response.json()).toEqual({ prompts: [] });
  });

  it('POST records a prompt and GET reflects it', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const create = await runHandler(
      POST,
      eventFor('POST', room.id, '', { rawText: 'Continue? [y/n]', detector: 'tty-confirm' })
    );
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.status).toBe('pending');

    const list = await runHandler(GET, eventFor('GET', room.id));
    const body = await list.json();
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].rawText).toBe('Continue? [y/n]');
    expect(body.prompts[0].detector).toBe('tty-confirm');
  });

  it('POST 400s when rawText is blank or missing', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const blank = await runHandler(POST, eventFor('POST', room.id, '', { rawText: '  ' }));
    expect(blank.status).toBe(400);
    const missing = await runHandler(POST, eventFor('POST', room.id, '', {}));
    expect(missing.status).toBe(400);
  });

  it('PATCH responded clears the prompt from the pending list', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const create = await runHandler(POST, eventFor('POST', room.id, '', { rawText: 'press enter' }));
    const created = await create.json();
    const patch = await runHandler(
      PATCH,
      eventFor('PATCH', room.id, `?promptId=${created.id}&status=responded`)
    );
    expect(patch.status).toBe(204);
    const list = await runHandler(GET, eventFor('GET', room.id));
    expect((await list.json()).prompts).toHaveLength(0);
  });

  it('PATCH 400s with an invalid status', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const create = await runHandler(POST, eventFor('POST', room.id, '', { rawText: 'press enter' }));
    const created = await create.json();
    const patch = await runHandler(
      PATCH,
      eventFor('PATCH', room.id, `?promptId=${created.id}&status=bogus`)
    );
    expect(patch.status).toBe(400);
  });

  it('PATCH 404s when prompt is already resolved or unknown', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const patch = await runHandler(
      PATCH,
      eventFor('PATCH', room.id, `?promptId=does-not-exist&status=responded`)
    );
    expect(patch.status).toBe(404);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-prompt', whoCreatedIt: '@you' });
    const response = await runHandler(
      POST,
      eventFor('POST', room.id, '', { rawText: 'nope' }, false)
    );
    expect(response.status).toBe(401);
  });

  it('PATCH returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-prompt-patch', whoCreatedIt: '@you' });
    const response = await runHandler(
      PATCH,
      eventFor('PATCH', room.id, `?promptId=p_x&status=responded`, undefined, false)
    );
    expect(response.status).toBe(401);
  });
});
