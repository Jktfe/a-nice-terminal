import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { addFileRef, resetFileRefsStoreForTests } from '\$lib/server/fileRefsStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string) {
  const url = new URL(`http://localhost/api/terminals/${id}/files`);
  return {
    request: new Request(url),
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

describe('/api/terminals/:id/files', () => {
  it('GET returns file refs scoped to terminal', async () => {
    addFileRef({ filePath: '/tmp/t1.txt', scope: 'terminal', scopeTarget: 'term-1' });
    addFileRef({ filePath: '/tmp/t2.txt', scope: 'terminal', scopeTarget: 'term-1' });
    addFileRef({ filePath: '/tmp/other.txt', scope: 'terminal', scopeTarget: 'term-2' });
    const res = await run(GET as unknown as AnyHandler, eventFor('term-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileRefs.length).toBe(2);
    expect(body.fileRefs.map((f: { filePath: string }) => f.filePath)).toContain('/tmp/t1.txt');
  });

  it('GET returns empty array when no file refs', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('term-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileRefs).toEqual([]);
  });

  it('GET 400 on empty id', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(400);
  });
});
