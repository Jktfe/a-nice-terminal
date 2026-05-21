import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { POST } from './+server';

vi.mock('\$lib/server/otlp/logsReceiver', () => ({
  decodeLogsServiceRequest: vi.fn().mockReturnValue({ resourceLogs: [] }),
  encodeLogsServiceResponseSuccess: vi.fn().mockReturnValue(new Uint8Array(0)),
  ingestDecodedLogsRequest: vi.fn().mockReturnValue({
    persistedCount: 0,
    totalLogRecords: 0,
    skippedNoEventName: 0,
    skippedNoSessionId: 0,
    errors: 0
  })
}));

vi.mock('\$lib/server/otlp/logsProto', () => ({
  getExportLogsServiceRequestType: vi.fn().mockReturnValue({
    fromObject: vi.fn().mockReturnValue({}),
    toObject: vi.fn().mockReturnValue({ resourceLogs: [] })
  })
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(contentType: string, body?: Uint8Array | string) {
  return {
    request: new Request('http://localhost/v1/logs', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: (body ?? null) as BodyInit
    }),
    url: new URL('http://localhost/v1/logs')
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

describe('/v1/logs', () => {
  it('POST 200 protobuf', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('application/x-protobuf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-protobuf');
    expect(res.headers.get('X-ANT-Persisted')).toBe('0');
  });

  it('POST 200 JSON', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('application/json', '{}'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = await res.json();
    expect(body).toEqual({});
  });

  it('POST 415 on unknown content-type', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('text/plain'));
    expect(res.status).toBe(415);
  });
});
