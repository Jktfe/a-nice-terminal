import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(slug: string) {
  return {
    request: new Request(`http://localhost/d/${slug}`),
    url: new URL(`http://localhost/d/${slug}`),
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
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/d/:slug', () => {
  it('GET 400 on invalid slug', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('../etc'));
    expect(res.status).toBe(400);
  });

  it('GET 404 when deck not built', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('nonexistent-deck'));
    expect(res.status).toBe(404);
  });
});
