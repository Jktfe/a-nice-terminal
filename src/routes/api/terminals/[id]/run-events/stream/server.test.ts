import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { GET } from './+server';

vi.mock('\$lib/server/terminalEventBroadcast', () => ({
  subscribeTerminalEvents: vi.fn().mockReturnValue(() => {})
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'terminal-run-events-stream-test-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, search = '', withAuth = true) {
  const headers = withAuth ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  return {
    request: new Request(`http://localhost/api/terminals/${id}/run-events/stream${search}`, { headers }),
    url: new URL(`http://localhost/api/terminals/${id}/run-events/stream${search}`),
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/terminals/:id/run-events/stream', () => {
  it('GET rejects anonymous reads before opening the classified event stream', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', '', false));
    expect(res.status).toBe(401);
  });

  it('GET returns SSE stream', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });

  it('GET 400 on empty id', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(400);
  });
});
