import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { createShareLink, getShareLink } from '$lib/server/shareLinkStore';

const ADMIN_TOKEN = 'share-token-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

type GetEvent = Parameters<typeof GET>[0];
type DeleteEvent = Parameters<typeof DELETE>[0];

function caughtResponse(thrownByHandler: unknown): Response {
  if (thrownByHandler instanceof Response) return thrownByHandler;
  const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
  if (typeof httpFailure?.status === 'number') {
    return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
  }
  throw thrownByHandler;
}

async function callGet(token: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(`http://localhost/api/share/${token}`);
  try {
    return (await GET({
      request: new Request(url),
      params: { token },
      url,
      fetch: fetchImpl
    } as unknown as GetEvent)) as Response;
  } catch (thrownByHandler) {
    return caughtResponse(thrownByHandler);
  }
}

async function callDelete(token: string, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }): Promise<Response> {
  const url = new URL(`http://localhost/api/share/${token}`);
  try {
    return (await DELETE({
      request: new Request(url, { method: 'DELETE', headers }),
      params: { token },
      url
    } as unknown as DeleteEvent)) as Response;
  } catch (thrownByHandler) {
    return caughtResponse(thrownByHandler);
  }
}

describe('/api/share/:token', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  it('GET returns a public room payload and increments access count', async () => {
    const room = createChatRoom({ name: 'public room', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'shareable update' });
    const link = createShareLink({ room_id: room.id, title: 'Public room', scope: 'room' });
    const fetchImpl = async (input: RequestInfo | URL) => {
      expect(String(input)).toContain(`/api/chat-rooms/${room.id}/messages?limit=100`);
      return new Response(JSON.stringify({
        messages: [{ id: 'm1', body: 'shareable update', authorHandle: '@you' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const response = await callGet(link.token, fetchImpl as typeof fetch);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.room).toEqual({ id: room.id, name: 'public room' });
    expect(body.title).toBe('Public room');
    expect(body.scope).toBe('room');
    expect(body.messages).toHaveLength(1);
    expect(getShareLink(link.token)?.access_count).toBe(1);
    expect(getShareLink(link.token)?.last_accessed_ms).not.toBeNull();
  });

  it('GET returns 404 for missing tokens and missing rooms', async () => {
    expect((await callGet('missing')).status).toBe(404);

    const link = createShareLink({ room_id: 'missing-room' });
    expect((await callGet(link.token)).status).toBe(404);
  });

  it('GET returns 410 for expired or revoked links', async () => {
    const room = createChatRoom({ name: 'share lifecycle', whoCreatedIt: '@you' });
    const expired = createShareLink({ room_id: room.id, expires_at_ms: Date.now() - 1 });
    expect((await callGet(expired.token)).status).toBe(410);

    const active = createShareLink({ room_id: room.id });
    expect((await callDelete(active.token)).status).toBe(200);
    expect((await callGet(active.token)).status).toBe(410);
  });

  it('DELETE revokes a link and rejects missing tokens', async () => {
    const room = createChatRoom({ name: 'revoke room', whoCreatedIt: '@you' });
    const link = createShareLink({ room_id: room.id });

    const response = await callDelete(link.token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: link.token });
    expect(getShareLink(link.token)?.revoked_at_ms).not.toBeNull();
    expect((await callDelete('missing')).status).toBe(404);
  });

  it('DELETE rejects anonymous revocation', async () => {
    const room = createChatRoom({ name: 'revoke auth', whoCreatedIt: '@you' });
    const link = createShareLink({ room_id: room.id });

    const response = await callDelete(link.token, {});

    expect(response.status).toBe(401);
    expect(getShareLink(link.token)?.revoked_at_ms).toBeNull();
  });
});
