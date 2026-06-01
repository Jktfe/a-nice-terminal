import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { getContextBreakEnforcement, resetContextBreakSettingsForTests } from '$lib/server/contextBreakSettingsStore';
import { GET, PATCH } from './+server';

const ADMIN_TOKEN_FOR_TESTS = 'context-break-settings-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

function eventFor(method: 'GET' | 'PATCH', roomId: string, body?: string, withAuth = true) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/context-break-settings`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(url, { method, headers, body });
  return { request, params: { roomId }, url } as unknown as Parameters<typeof PATCH>[0];
}

async function runHandler(
  handler: (event: Parameters<typeof PATCH>[0]) => unknown,
  event: Parameters<typeof PATCH>[0]
): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

const callGet = (roomId: string, withAuth = true) => runHandler(GET, eventFor('GET', roomId, undefined, withAuth));
const callPatch = (roomId: string, body: string, withAuth = true) =>
  runHandler(PATCH, eventFor('PATCH', roomId, body, withAuth));

describe('/api/chat-rooms/:roomId/context-break-settings', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetContextBreakSettingsForTests();
  });

  it('GET returns the current per-room enforcement mode', async () => {
    const room = createChatRoom({ name: 'read-setting', whoCreatedIt: '@you' });

    const response = await callGet(room.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enforcement: 'hard' });
  });

  it('PATCH requires room mutation auth and persists the requested mode', async () => {
    const room = createChatRoom({ name: 'write-setting', whoCreatedIt: '@you' });

    const unauth = await callPatch(room.id, JSON.stringify({ enforcement: 'off' }), false);
    expect(unauth.status).toBe(401);

    const authed = await callPatch(room.id, JSON.stringify({ enforcement: 'off' }));
    expect(authed.status).toBe(200);
    expect(await authed.json()).toEqual({ enforcement: 'off' });
    expect(getContextBreakEnforcement(room.id)).toBe('off');
  });

  it('PATCH rejects invalid modes', async () => {
    const room = createChatRoom({ name: 'invalid-setting', whoCreatedIt: '@you' });

    const response = await callPatch(room.id, JSON.stringify({ enforcement: 'maybe' }));

    expect(response.status).toBe(400);
    expect(getContextBreakEnforcement(room.id)).toBe('hard');
  });
});
