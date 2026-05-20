import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createTerminalRecord } from '\$lib/server/terminalRecordsStore';
import { GET, PATCH } from './+server';

vi.mock('\$lib/server/ptyClient', () => ({
  listTerminals: async () => []
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, method: 'GET' | 'PATCH', body?: unknown) {
  const url = new URL(`http://localhost/api/terminals/${id}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request(url, init),
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

describe('/api/terminals/:id', () => {
  it('GET returns terminal record', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', handle: '@alpha' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('t-1');
    expect(body.name).toBe('Alpha');
    expect(body.handle).toBe('@alpha');
    expect(body.alive).toBe(false);
  });

  it('GET 400 on empty id', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('', 'GET'));
    expect(res.status).toBe(400);
  });

  it('GET 404 for missing terminal', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET'));
    expect(res.status).toBe(404);
  });

  it('PATCH updates terminal fields', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('t-1', 'PATCH', {
      name: 'Beta',
      autoForwardRoomId: 'room-1',
      autoForwardChat: 1,
      handle: '@beta'
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Beta');
    expect(body.autoForwardRoomId).toBe('room-1');
    expect(body.autoForwardChat).toBe(1);
    expect(body.handle).toBe('@beta');
  });

  it('PATCH 400 on empty id', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('', 'PATCH', { name: 'X' }));
    expect(res.status).toBe(400);
  });

  it('PATCH 404 for missing terminal', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('missing', 'PATCH', { name: 'X' }));
    expect(res.status).toBe(404);
  });
});
