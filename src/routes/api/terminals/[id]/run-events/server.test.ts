import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { appendTerminalRunEvent } from '\$lib/server/terminalRunEventsStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'terminal-run-events-test-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, search: string, withAuth = true) {
  const headers = withAuth ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  return {
    request: new Request(`http://localhost/api/terminals/${id}/run-events${search}`, { headers }),
    url: new URL(`http://localhost/api/terminals/${id}/run-events${search}`),
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
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/terminals/:id/run-events', () => {
  it('GET rejects anonymous reads before exposing transcript events', async () => {
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'SECRET_TOKEN=should-not-leak' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', '', false));
    expect(res.status).toBe(401);
    await expect(res.text()).resolves.not.toContain('SECRET_TOKEN');
  });

  it('GET lists latest events', async () => {
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'command_block', text: 'ls' });
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'file.txt' });
    appendTerminalRunEvent({ terminalId: 't-2', kind: 'command_block', text: 'pwd' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', ''));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(2);
  });

  it('GET respects limit', async () => {
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'a' });
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'b' });
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'c' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', '?limit=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(2);
  });

  it('GET supports since filter', async () => {
    const oldTs = Date.now() - 60_000;
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'old', tsMs: oldTs });
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'new' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', `?since=${oldTs + 1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(1);
    expect(body.events[0].text).toBe('new');
  });

  it('GET supports grep search', async () => {
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'hello world' });
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'output', text: 'goodbye' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', '?grep=hello'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('search');
    expect(body.events.length).toBe(1);
    expect(body.events[0].text).toBe('hello world');
  });

  it('GET supports raw=1 flag', async () => {
    appendTerminalRunEvent({ terminalId: 't-1', kind: 'raw', text: '\x1b[31mred\x1b[0m' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', '?raw=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.raw).toBe(true);
  });

  it('GET 400 on empty id', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('', ''));
    expect(res.status).toBe(400);
  });
});
