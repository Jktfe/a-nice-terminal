import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor() {
  return {
    request: new Request('http://localhost/api/mcp/cli-verbs/_summary'),
    url: new URL('http://localhost/api/mcp/cli-verbs/_summary')
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
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/mcp/cli-verbs/_summary', () => {
  it('GET returns manifest summary', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.total).toBe('number');
    expect(typeof body.available).toBe('number');
    expect(typeof body.needsWrapper).toBe('number');
    expect(typeof body.planned).toBe('number');
    expect(Array.isArray(body.verbs)).toBe(true);
    expect(body.verbs.length).toBe(body.total);
    if (body.verbs.length > 0) {
      expect(body.verbs[0]).toHaveProperty('id');
      expect(body.verbs[0]).toHaveProperty('usage');
      expect(body.verbs[0]).toHaveProperty('summary');
      expect(body.verbs[0]).toHaveProperty('status');
    }
  });
});
