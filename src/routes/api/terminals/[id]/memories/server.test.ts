import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { putMemory, resetMemoriesStoreForTests } from '\$lib/server/memoriesStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'terminal-memories-test-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, withAuth = true) {
  const url = new URL(`http://localhost/api/terminals/${id}/memories`);
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
  resetMemoriesStoreForTests();
});

afterEach(() => {
  resetMemoriesStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/terminals/:id/memories', () => {
  it('GET rejects anonymous reads before exposing terminal memories', async () => {
    putMemory({ key: 'secret-memory', value: 'do-not-leak', scope: 'terminal', scopeTarget: 'term-1' });
    const res = await run(GET as unknown as AnyHandler, eventFor('term-1', false));
    expect(res.status).toBe(401);
    await expect(res.text()).resolves.not.toContain('do-not-leak');
  });

  it('GET returns memories scoped to terminal', async () => {
    putMemory({ key: 't1/m1', value: 'v1', scope: 'terminal', scopeTarget: 'term-1' });
    putMemory({ key: 't1/m2', value: 'v2', scope: 'terminal', scopeTarget: 'term-1' });
    putMemory({ key: 't2/m1', value: 'v3', scope: 'terminal', scopeTarget: 'term-2' });
    const res = await run(GET as unknown as AnyHandler, eventFor('term-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories.length).toBe(2);
    expect(body.memories.map((m: { key: string }) => m.key)).toContain('t1/m1');
  });

  it('GET returns empty array when no memories', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('term-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toEqual([]);
  });
});
