import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { addFileRef, resetFileRefsStoreForTests } from '\$lib/server/fileRefsStore';
import { GET, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const ADMIN_TOKEN = 'file-refs-id-test-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  id: string,
  method: 'GET' | 'DELETE',
  headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }
) {
  const url = new URL(`http://localhost/api/file-refs/${id}`);
  return {
    request: new Request(url, { method, headers }),
    url,
    params: { id }
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
  resetFileRefsStoreForTests();
});

afterEach(() => {
  resetFileRefsStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/file-refs/:id', () => {
  it('GET and DELETE reject anonymous access', async () => {
    const ref = addFileRef({ filePath: '/tmp/test.txt', scope: 'global' });

    const read = await run(GET as unknown as AnyHandler, eventFor(ref.id, 'GET', {}));
    expect(read.status).toBe(401);

    const deleted = await run(DELETE as unknown as AnyHandler, eventFor(ref.id, 'DELETE', {}));
    expect(deleted.status).toBe(401);
  });

  it('GET returns the file_ref', async () => {
    const ref = addFileRef({ filePath: '/tmp/test.txt', scope: 'global' });
    const res = await run(GET as unknown as AnyHandler, eventFor(ref.id, 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileRef.id).toBe(ref.id);
    expect(body.fileRef.filePath).toBe('/tmp/test.txt');
  });

  it('GET 404 for missing file_ref', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET'));
    expect(res.status).toBe(404);
  });

  it('DELETE removes the file_ref and returns 204', async () => {
    const ref = addFileRef({ filePath: '/tmp/del.txt', scope: 'global' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor(ref.id, 'DELETE'));
    expect(res.status).toBe(204);
  });

  it('DELETE 404 for missing file_ref', async () => {
    const res = await run(DELETE as unknown as AnyHandler, eventFor('missing', 'DELETE'));
    expect(res.status).toBe(404);
  });
});
