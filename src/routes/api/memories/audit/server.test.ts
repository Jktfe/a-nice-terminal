import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { putMemory, resetMemoriesStoreForTests } from '\$lib/server/memoriesStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(search: string) {
  return {
    request: new Request(`http://localhost/api/memories/audit${search}`),
    url: new URL(`http://localhost/api/memories/audit${search}`)
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

describe('/api/memories/audit', () => {
  it('GET lists audit entries', async () => {
    putMemory({ key: 'k1', value: 'v1', scope: 'global' });
    putMemory({ key: 'k1', value: 'v2', scope: 'global' });
    putMemory({ key: 'k2', value: 'v1', scope: 'global' });
    const res = await run(GET as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audit.length).toBeGreaterThanOrEqual(2);
  });

  it('GET filters by key', async () => {
    putMemory({ key: 'k1', value: 'v1', scope: 'global' });
    putMemory({ key: 'k2', value: 'v1', scope: 'global' });
    const res = await run(GET as unknown as AnyHandler, eventFor('?key=k1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    console.log("audit keys:", body.audit.map((a: { memoryKey: string }) => a.memoryKey)); expect(body.audit.length).toBeGreaterThan(0); expect(body.audit.some((a: { memoryKey: string }) => a.memoryKey==='k2')).toBe(false);
  });

  it('GET respects limit', async () => {
    putMemory({ key: 'k1', value: 'v1', scope: 'global' });
    putMemory({ key: 'k1', value: 'v2', scope: 'global' });
    putMemory({ key: 'k1', value: 'v3', scope: 'global' });
    const res = await run(GET as unknown as AnyHandler, eventFor('?key=k1&limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audit.length).toBe(2);
  });
});
