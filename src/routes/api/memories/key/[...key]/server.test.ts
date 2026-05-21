import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { putMemory, resetMemoriesStoreForTests } from '\$lib/server/memoriesStore';
import { GET, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(key: string, method: 'GET' | 'DELETE', search = '') {
  const url = new URL(`http://localhost/api/memories/key/${key}${search}`);
  const init: RequestInit = { method };
  return {
    request: new Request(url, init),
    url,
    params: { key }
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
  resetMemoriesStoreForTests();
});

afterEach(() => {
  resetMemoriesStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/memories/key/:key', () => {
  it('GET returns a memory', async () => {
    putMemory({ key: 'test/key', value: 'hello', scope: 'global' });
    const res = await run(GET as unknown as AnyHandler, eventFor('test/key', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memory.key).toBe('test/key');
    expect(body.memory.value).toBe('hello');
  });

  it('GET 404 for missing memory', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET'));
    expect(res.status).toBe(404);
  });

  it('GET handles nested keys', async () => {
    putMemory({ key: 'agents/researchant/role', value: 'research', scope: 'global' });
    const res = await run(GET as unknown as AnyHandler, eventFor('agents/researchant/role', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memory.value).toBe('research');
  });

  it('DELETE removes a memory', async () => {
    putMemory({ key: 'del-key', value: 'bye', scope: 'global' });
    const res = await run(DELETE as unknown as AnyHandler, eventFor('del-key', 'DELETE'));
    expect(res.status).toBe(204);
  });

  it('DELETE 404 for missing memory', async () => {
    const res = await run(DELETE as unknown as AnyHandler, eventFor('missing', 'DELETE'));
    expect(res.status).toBe(404);
  });
});
