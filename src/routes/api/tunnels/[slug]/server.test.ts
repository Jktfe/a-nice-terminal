import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '\$lib/server/chatRoomStore';
import { createTunnel } from '\$lib/server/tunnelStore';
import { GET, PATCH, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'single-tunnel-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  slug: string,
  method: 'GET' | 'PATCH' | 'DELETE',
  body?: unknown,
  headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }
) {
  const url = new URL(`http://localhost/api/tunnels/${slug}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json', ...headers };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request(url, init),
    url,
    params: { slug }
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

describe('/api/tunnels/:slug', () => {
  it('GET returns the tunnel', async () => {
    const room = createChatRoom({ name: 'T Room', whoCreatedIt: '@you' });
    createTunnel({ slug: 's1', public_url: 'https://s1.test', owner_room_id: room.id, access_required: false, allowed_room_ids: [], status: 'linked' });
    const res = await run(GET as unknown as AnyHandler, eventFor('s1', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tunnel.slug).toBe('s1');
    expect(body.tunnel.public_url).toBe('https://s1.test');
  });

  it('GET rejects anonymous tunnel detail reads', async () => {
    const room = createChatRoom({ name: 'T Room', whoCreatedIt: '@you' });
    createTunnel({ slug: 's1', public_url: 'https://s1.test', owner_room_id: room.id, access_required: false, allowed_room_ids: [], status: 'linked' });
    const res = await run(GET as unknown as AnyHandler, eventFor('s1', 'GET', undefined, {}));
    expect(res.status).toBe(401);
  });

  it('GET 404 for missing tunnel', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET'));
    expect(res.status).toBe(404);
  });

  it('PATCH updates tunnel fields', async () => {
    const room = createChatRoom({ name: 'T Room', whoCreatedIt: '@you' });
    createTunnel({ slug: 's1', public_url: 'https://s1.test', owner_room_id: room.id, access_required: false, allowed_room_ids: [], status: 'linked' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('s1', 'PATCH', {
      title: 'Updated',
      public_url: 'https://updated.test',
      status: 'offline'
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tunnel.title).toBe('Updated');
    expect(body.tunnel.public_url).toBe('https://updated.test');
    expect(body.tunnel.status).toBe('offline');
  });

  it('PATCH rejects anonymous updates', async () => {
    const room = createChatRoom({ name: 'T Room', whoCreatedIt: '@you' });
    createTunnel({ slug: 's1', public_url: 'https://s1.test', owner_room_id: room.id, access_required: false, allowed_room_ids: [], status: 'linked' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('s1', 'PATCH', { title: 'Updated' }, {}));
    expect(res.status).toBe(401);
  });

  it('PATCH 404 for missing tunnel', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('missing', 'PATCH', { title: 'X' }));
    expect(res.status).toBe(404);
  });

  it('DELETE removes the tunnel', async () => {
    const room = createChatRoom({ name: 'T Room', whoCreatedIt: '@you' });
    createTunnel({ slug: 's1', public_url: 'https://s1.test', owner_room_id: room.id, access_required: false, allowed_room_ids: [], status: 'linked' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor('s1', 'DELETE'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('s1');
  });

  it('DELETE rejects anonymous deletes', async () => {
    const room = createChatRoom({ name: 'T Room', whoCreatedIt: '@you' });
    createTunnel({ slug: 's1', public_url: 'https://s1.test', owner_room_id: room.id, access_required: false, allowed_room_ids: [], status: 'linked' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor('s1', 'DELETE', undefined, {}));
    expect(res.status).toBe(401);
  });

  it('DELETE 404 for missing tunnel', async () => {
    const res = await run(DELETE as unknown as AnyHandler, eventFor('missing', 'DELETE'));
    expect(res.status).toBe(404);
  });
});
