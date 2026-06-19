import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';

const ADMIN_TOKEN = 'share-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

function caughtResponse(thrownByHandler: unknown): Response {
  if (thrownByHandler instanceof Response) return thrownByHandler;
  const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
  if (typeof httpFailure?.status === 'number') {
    return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
  }
  throw thrownByHandler;
}

async function callGet(search = '', headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }): Promise<Response> {
  const url = new URL(`http://localhost/api/share${search}`);
  try {
    return (await GET({ request: new Request(url, { headers }), params: {}, url } as unknown as GetEvent)) as Response;
  } catch (thrownByHandler) {
    return caughtResponse(thrownByHandler);
  }
}

async function callPost(body: unknown, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }): Promise<Response> {
  const url = new URL('http://localhost/api/share');
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  try {
    return (await POST({ request, params: {}, url } as unknown as PostEvent)) as Response;
  } catch (thrownByHandler) {
    return caughtResponse(thrownByHandler);
  }
}

describe('/api/share', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  it('rejects anonymous share-link creation and listing', async () => {
    const room = createChatRoom({ name: 'private room', whoCreatedIt: '@you' });
    expect((await callPost({ roomId: room.id, title: 'leak', scope: 'messages' }, {})).status).toBe(401);
    expect((await callGet(`?roomId=${room.id}`, {})).status).toBe(401);
  });

  it('POST creates a share link and GET lists it for the room', async () => {
    const room = createChatRoom({ name: 'share me', whoCreatedIt: '@you' });
    const createResponse = await callPost({
      roomId: room.id,
      title: 'Public room view',
      scope: 'messages',
      createdBy: '@you'
    });
    expect(createResponse.status).toBe(201);
    const createBody = await createResponse.json();
    expect(createBody.link).toMatchObject({
      room_id: room.id,
      title: 'Public room view',
      scope: 'messages',
      created_by: '@admin',
      access_count: 0
    });
    expect(createBody.link.token).toHaveLength(24);

    const listResponse = await callGet(`?roomId=${room.id}`);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.links).toHaveLength(1);
    expect(listBody.links[0].token).toBe(createBody.link.token);
  });

  it('GET rejects a missing roomId and unknown rooms', async () => {
    expect((await callGet()).status).toBe(400);
    expect((await callGet('?roomId=missing')).status).toBe(404);
  });

  it('POST rejects a missing roomId and unknown rooms', async () => {
    expect((await callPost({})).status).toBe(400);
    expect((await callPost({ roomId: 'missing' })).status).toBe(404);
  });
});
