import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { addFileRef, resetFileRefsStoreForTests } from '\$lib/server/fileRefsStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'terminal-files-test-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, withAuth = true) {
  const url = new URL(`http://localhost/api/terminals/${id}/files`);
  const headers = withAuth ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  return {
    request: new Request(url, { headers }),
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
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
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

describe('/api/terminals/:id/files', () => {
  it('GET rejects anonymous reads before exposing terminal file refs', async () => {
    addFileRef({ filePath: '/tmp/secret.txt', scope: 'terminal', scopeTarget: 'term-1' });
    const res = await run(GET as unknown as AnyHandler, eventFor('term-1', false));
    expect(res.status).toBe(401);
    await expect(res.text()).resolves.not.toContain('/tmp/secret.txt');
  });

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
