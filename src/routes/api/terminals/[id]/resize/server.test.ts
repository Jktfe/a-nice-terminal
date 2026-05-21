import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { POST } from './+server';

vi.mock('\$lib/server/ptyClient', () => ({
  resizeTerminal: vi.fn()
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, body?: unknown) {
  const url = new URL(`http://localhost/api/terminals/${id}/resize`);
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/terminals/:id/resize', () => {
  it('POST 202 resizes terminal', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { cols: 80, rows: 24 }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST 400 on empty id', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('', { cols: 80, rows: 24 }));
    expect(res.status).toBe(400);
  });

  it('POST 400 when cols is missing', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { rows: 24 }));
    expect(res.status).toBe(400);
  });

  it('POST 400 when rows is not finite', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('t-1', { cols: 80, rows: Infinity }));
    expect(res.status).toBe(400);
  });
});
