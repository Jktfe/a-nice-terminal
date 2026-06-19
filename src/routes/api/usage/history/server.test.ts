import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { insertUsageSnapshot, resetUsageSnapshotStoreForTests } from '$lib/server/usageSnapshotStore';

const ADMIN_TOKEN = 'usage-history-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(search = '', headers: HeadersInit = {}) {
  const url = new URL(`http://localhost/api/usage/history${search}`);
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
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetUsageSnapshotStoreForTests();
});

afterEach(() => {
  resetUsageSnapshotStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('GET /api/usage/history', () => {
  it('rejects anonymous usage history reads', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor());
    expect(res.status).toBe(401);
  });

  it('returns recent snapshots for authenticated callers', async () => {
    insertUsageSnapshot({ providers: [], proxyFetchedAt: '2026-06-19T00:00:00.000Z', daemonReachable: true });
    const res = await run(
      GET as unknown as AnyHandler,
      eventFor('?limit=1', { authorization: `Bearer ${ADMIN_TOKEN}` })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshots).toHaveLength(1);
  });
});
