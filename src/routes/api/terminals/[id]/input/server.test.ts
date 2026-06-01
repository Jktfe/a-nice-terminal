import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { POST } from './+server';

vi.mock('$lib/server/ptyClient', () => ({
  writeInput: vi.fn()
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'test-admin-token-input';

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, body?: unknown, opts?: { auth?: boolean }) {
  const url = new URL(`http://localhost/api/terminals/${id}/input`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts?.auth !== false) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  return {
    request: new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {})
    }),
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

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
});

afterAll(() => {
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/terminals/:id/input', () => {
  it('POST 202 writes input', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { data: 'hello' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST 400 on empty id', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('', { data: 'hello' }));
    expect(res.status).toBe(400);
  });

  it('POST 400 when data is missing', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', {}));
    expect(res.status).toBe(400);
  });

  it('POST 400 when data is not a string', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { data: 123 }));
    expect(res.status).toBe(400);
  });

  it('POST 401 when no auth is supplied (CVE FIX A 2026-05-19)', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { data: 'hello' }, { auth: false }));
    expect(res.status).toBe(401);
  });
});
