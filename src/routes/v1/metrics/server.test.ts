import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(contentType: string, body?: Uint8Array) {
  return {
    request: new Request('http://localhost/v1/metrics', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: (body ?? null) as BodyInit
    }),
    url: new URL('http://localhost/v1/metrics')
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

describe('/v1/metrics', () => {
  it('POST 200 protobuf stub', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('application/x-protobuf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-protobuf');
    expect(res.headers.get('X-ANT-Metrics-Handler')).toBe('stub');
  });

  it('POST 200 JSON stub', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('application/json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('X-ANT-Metrics-Handler')).toBe('stub');
    const body = await res.json();
    expect(body).toEqual({});
  });
});
