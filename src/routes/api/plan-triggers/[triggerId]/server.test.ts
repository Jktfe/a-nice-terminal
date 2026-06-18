import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import {
  addTrigger,
  getTrigger,
  _resetPlanTriggerStoreForTests
} from '\$lib/server/planTriggerStore';
import { GET, DELETE } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'trigger-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(triggerId: string, method: 'GET' | 'DELETE', token: string | null = ADMIN_TOKEN) {
  const url = new URL(`http://localhost/api/plan-triggers/${triggerId}`);
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    request: new Request(url, { method, headers }),
    url,
    params: { triggerId }
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
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  _resetPlanTriggerStoreForTests();
});

afterEach(() => {
  _resetPlanTriggerStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('/api/plan-triggers/:triggerId', () => {
  it('GET returns the trigger', async () => {
    const trigger = addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: { message: 'secret-ish' } });
    const res = await run(GET as unknown as AnyHandler, eventFor(trigger.id, 'GET', null));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trigger.id).toBe(trigger.id);
    expect(body.trigger.event).toBe('plan.completed');
    expect(body.trigger.actionConfig).toEqual({});
    expect(body.trigger.actionConfigRedacted).toBe(true);
  });

  it('GET includes actionConfig for admin bearer readers', async () => {
    const trigger = addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: { message: 'secret-ish' } });
    const res = await run(GET as unknown as AnyHandler, eventFor(trigger.id, 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trigger.actionConfig).toEqual({ message: 'secret-ish' });
    expect(body.trigger.actionConfigRedacted).toBeUndefined();
  });

  it('GET 404s for missing trigger', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('ghost', 'GET'));
    expect(res.status).toBe(404);
  });

  it('GET 400s for empty triggerId', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('', 'GET'));
    expect(res.status).toBe(400);
  });

  it('DELETE removes trigger when admin', async () => {
    const trigger = addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: {} });
    const res = await run(DELETE as unknown as AnyHandler, eventFor(trigger.id, 'DELETE'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(true);
    expect(getTrigger(trigger.id)).toBeNull();
  });

  it('DELETE 401 without admin bearer', async () => {
    const trigger = addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: {} });
    const res = await run(DELETE as unknown as AnyHandler, eventFor(trigger.id, 'DELETE', null));
    expect(res.status).toBe(401);
  });

  it('DELETE 404 for missing trigger', async () => {
    const res = await run(DELETE as unknown as AnyHandler, eventFor('ghost', 'DELETE'));
    expect(res.status).toBe(404);
  });
});
