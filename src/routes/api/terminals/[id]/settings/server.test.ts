import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, PATCH } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { getTerminalById, upsertTerminal } from '$lib/server/terminalsStore';

const ADMIN_TOKEN_FOR_TESTS = 'terminal-settings-test-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
  resetIdentityDbForTests();
});

afterAll(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

type AnyHandler = (event: unknown) => unknown;

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

function eventFor(method: string, id: string, body?: Record<string, unknown>, withAuth = true) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    params: { id },
    request: new Request(`http://localhost/api/terminals/${id}/settings`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  };
}

describe('/api/terminals/[id]/settings deliveryMode', () => {
  it('defaults deliveryMode to inject', async () => {
    const terminal = upsertTerminal({ pid: 1001, pid_start: 'p', name: 'mode-default' });

    const response = await runHandler(GET as AnyHandler, eventFor('GET', terminal.id));
    expect(response.status).toBe(200);
    const body = await response.json() as { deliveryMode: string };
    expect(body.deliveryMode).toBe('inject');
  });

  it('persists queue_raw without dropping existing terminal meta', async () => {
    const terminal = upsertTerminal({
      pid: 1002,
      pid_start: 'p',
      name: 'mode-raw',
      meta: { existing: 'kept' }
    });

    const patch = await runHandler(
      PATCH as AnyHandler,
      eventFor('PATCH', terminal.id, { field: 'deliveryMode', value: 'queue_raw' })
    );
    expect(patch.status).toBe(200);

    const reread = await runHandler(GET as AnyHandler, eventFor('GET', terminal.id));
    const body = await reread.json() as { deliveryMode: string };
    expect(body.deliveryMode).toBe('queue_raw');

    const meta = JSON.parse(getTerminalById(terminal.id)?.meta ?? '{}') as Record<string, unknown>;
    expect(meta.existing).toBe('kept');
    expect(meta.deliveryMode).toBe('queue_raw');
  });

  it('rejects unknown delivery modes', async () => {
    const terminal = upsertTerminal({ pid: 1003, pid_start: 'p', name: 'mode-bad' });

    const response = await runHandler(
      PATCH as AnyHandler,
      eventFor('PATCH', terminal.id, { field: 'deliveryMode', value: 'queue_everything' })
    );

    expect(response.status).toBe(400);
  });
});
