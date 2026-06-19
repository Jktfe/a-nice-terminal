import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { resetOpenUsageCacheForTests } from '$lib/server/openUsageProxy';

const ADMIN_TOKEN = 'usage-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

type AnyHandler = (event: unknown) => unknown;

function eventFor(headers: HeadersInit = {}) {
  const url = new URL('http://localhost/api/usage');
  return { request: new Request(url, { headers }), url };
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
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetOpenUsageCacheForTests();
});

afterEach(() => {
  resetOpenUsageCacheForTests();
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('GET /api/usage', () => {
  it('rejects anonymous usage telemetry reads', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor());
    expect(res.status).toBe(401);
  });

  it('returns a usage payload for authenticated callers', async () => {
    const res = await run(
      GET as unknown as AnyHandler,
      eventFor({ authorization: `Bearer ${ADMIN_TOKEN}` })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.providers)).toBe(true);
    expect(typeof body.daemonReachable).toBe('boolean');
  });
});
