import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createTunnel } from '$lib/server/tunnelStore';
import { GET, POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'tunnels-admin-token';

type AnyHandler = (event: unknown) => unknown;

function seedTunnel(input: { slug: string; public_url: string; owner_room_id: string }) {
  return createTunnel({
    ...input,
    allowed_room_ids: [],
    access_required: false,
    status: 'linked'
  });
}

function getEvent(search: string, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }) {
  return {
    request: new Request(`http://localhost/api/tunnels${search}`, { headers }),
    url: new URL(`http://localhost/api/tunnels${search}`)
  };
}

function postEvent(body: unknown, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }) {
  return {
    request: new Request('http://localhost/api/tunnels', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    url: new URL('http://localhost/api/tunnels')
  };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/tunnels', () => {
  it('GET 400 without roomId', async () => {
    const res = await run(GET as unknown as AnyHandler, getEvent(''));
    expect(res.status).toBe(400);
  });

  it('GET 404 for unknown room', async () => {
    const res = await run(GET as unknown as AnyHandler, getEvent('?roomId=missing'));
    expect(res.status).toBe(404);
  });

  it('GET lists tunnels for a room', async () => {
    const room = createChatRoom({ name: 'Tunnel Room', whoCreatedIt: '@you' });
    seedTunnel({ slug: 't1', public_url: 'https://t1.test', owner_room_id: room.id });
    const res = await run(GET as unknown as AnyHandler, getEvent(`?roomId=${room.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tunnels.length).toBe(1);
    expect(body.tunnels[0].slug).toBe('t1');
  });

  it('GET rejects anonymous tunnel listing for a real room', async () => {
    const room = createChatRoom({ name: 'Tunnel Room', whoCreatedIt: '@you' });
    seedTunnel({ slug: 't1', public_url: 'https://t1.test', owner_room_id: room.id });
    const res = await run(GET as unknown as AnyHandler, getEvent(`?roomId=${room.id}`, {}));
    expect(res.status).toBe(401);
  });

  it('POST creates a tunnel', async () => {
    const room = createChatRoom({ name: 'Tunnel Room', whoCreatedIt: '@you' });
    const res = await run(POST as unknown as AnyHandler, postEvent({
      roomId: room.id,
      slug: 'new-tunnel',
      public_url: 'https://new.test'
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tunnel.slug).toBe('new-tunnel');
    expect(body.tunnel.public_url).toBe('https://new.test');
    expect(body.tunnel.owner_room_id).toBe(room.id);
  });

  it('POST rejects anonymous tunnel creation for a real room', async () => {
    const room = createChatRoom({ name: 'Tunnel Room', whoCreatedIt: '@you' });
    const res = await run(POST as unknown as AnyHandler, postEvent({
      roomId: room.id,
      slug: 'new-tunnel',
      public_url: 'https://new.test'
    }, {}));
    expect(res.status).toBe(401);
  });

  it('POST 400 without roomId', async () => {
    const res = await run(POST as unknown as AnyHandler, postEvent({ slug: 'x', public_url: 'https://x.test' }));
    expect(res.status).toBe(400);
  });

  it('POST 404 for unknown room', async () => {
    const res = await run(POST as unknown as AnyHandler, postEvent({ roomId: 'missing', slug: 'x', public_url: 'https://x.test' }));
    expect(res.status).toBe(404);
  });

  it('POST 409 on duplicate slug', async () => {
    const room = createChatRoom({ name: 'Tunnel Room', whoCreatedIt: '@you' });
    seedTunnel({ slug: 'dup', public_url: 'https://dup.test', owner_room_id: room.id });
    const res = await run(POST as unknown as AnyHandler, postEvent({
      roomId: room.id,
      slug: 'dup',
      public_url: 'https://dup2.test'
    }));
    expect(res.status).toBe(409);
  });
});
