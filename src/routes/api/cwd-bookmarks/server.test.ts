import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { DELETE } from './[id]/+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createCwdBookmark, resetCwdBookmarksStoreForTests } from '$lib/server/cwdBookmarksStore';

const ADMIN_TOKEN = 'cwd-bookmarks-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function listEvent(headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }) {
  const url = new URL('http://localhost/api/cwd-bookmarks');
  return { request: new Request(url, { headers }), url };
}

function postEvent(body: unknown, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }) {
  const url = new URL('http://localhost/api/cwd-bookmarks');
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    url
  };
}

function deleteEvent(id: string, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }) {
  const url = new URL(`http://localhost/api/cwd-bookmarks/${id}`);
  return { request: new Request(url, { method: 'DELETE', headers }), params: { id }, url };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
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

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetCwdBookmarksStoreForTests();
});

afterEach(() => {
  resetCwdBookmarksStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/cwd-bookmarks', () => {
  it('rejects anonymous list/create/delete access', async () => {
    const bookmark = createCwdBookmark({ path: '/tmp' });
    expect((await run(GET as unknown as AnyHandler, listEvent({}))).status).toBe(401);
    expect((await run(POST as unknown as AnyHandler, postEvent({ path: '/var' }, {}))).status).toBe(401);
    expect((await run(DELETE as unknown as AnyHandler, deleteEvent(bookmark.id, {}))).status).toBe(401);
  });

  it('creates, lists, and deletes bookmarks for authenticated callers', async () => {
    const created = await run(POST as unknown as AnyHandler, postEvent({ path: '/tmp' }));
    expect(created.status).toBe(201);
    const bookmark = (await created.json()).bookmark;

    const listed = await run(GET as unknown as AnyHandler, listEvent());
    expect(listed.status).toBe(200);
    expect((await listed.json()).bookmarks).toHaveLength(1);

    const deleted = await run(DELETE as unknown as AnyHandler, deleteEvent(bookmark.id));
    expect(deleted.status).toBe(204);
  });
});
