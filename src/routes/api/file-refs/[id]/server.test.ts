import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { addFileRef, resetFileRefsStoreForTests } from '\$lib/server/fileRefsStore';
import { GET, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, method: 'GET' | 'DELETE') {
  const url = new URL(`http://localhost/api/file-refs/${id}`);
  return {
    request: new Request(url, { method }),
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
  resetIdentityDbForTests();
  resetFileRefsStoreForTests();
});

afterEach(() => {
  resetFileRefsStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/file-refs/:id', () => {
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
