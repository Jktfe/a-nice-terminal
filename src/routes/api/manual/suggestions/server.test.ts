import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { PATCH } from './[id]/+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createSuggestion } from '$lib/server/manualScreenStore';

const ADMIN_TOKEN = 'manual-suggestions-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function getEvent(headers: HeadersInit = {}) {
  const url = new URL('http://localhost/api/manual/suggestions');
  return { request: new Request(url, { headers }), url };
}

function postEvent(body: unknown, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }) {
  const url = new URL('http://localhost/api/manual/suggestions');
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    url
  };
}

function patchEvent(id: string, body: unknown, headers: HeadersInit = { authorization: `Bearer ${ADMIN_TOKEN}` }) {
  const url = new URL(`http://localhost/api/manual/suggestions/${id}`);
  return {
    request: new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    params: { id },
    url
  };
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
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/manual/suggestions', () => {
  it('rejects anonymous list/create/update access', async () => {
    const suggestion = createSuggestion({ body: 'wire me', capturedByHandle: '@admin' });
    expect((await run(GET as unknown as AnyHandler, getEvent())).status).toBe(401);
    expect((await run(POST as unknown as AnyHandler, postEvent({ body: 'anon' }, {}))).status).toBe(401);
    expect((await run(PATCH as unknown as AnyHandler, patchEvent(suggestion.id, { status: 'addressed' }, {}))).status).toBe(401);
  });

  it('creates and lists suggestions for authenticated callers with server-side attribution', async () => {
    const create = await run(
      POST as unknown as AnyHandler,
      postEvent({ body: 'wire me', capturedByHandle: '@spoof' })
    );
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.suggestion.captured_by_handle).toBe('@admin');

    const list = await run(
      GET as unknown as AnyHandler,
      getEvent({ authorization: `Bearer ${ADMIN_TOKEN}` })
    );
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.suggestions).toHaveLength(1);
  });

  it('updates suggestion status with server-side attribution', async () => {
    const suggestion = createSuggestion({ body: 'wire me', capturedByHandle: '@admin' });
    const res = await run(
      PATCH as unknown as AnyHandler,
      patchEvent(suggestion.id, { status: 'addressed', addressedByHandle: '@spoof' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestion.addressed_by_handle).toBe('@admin');
  });
});
