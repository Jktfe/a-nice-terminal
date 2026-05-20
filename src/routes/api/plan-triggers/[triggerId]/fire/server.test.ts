import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  addTrigger,
  _resetPlanTriggerStoreForTests
} from '$lib/server/planTriggerStore';
import { POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'trigger-fire-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  triggerId: string,
  body?: unknown,
  token: string | null = ADMIN_TOKEN
) {
  const url = new URL(`http://localhost/api/plan-triggers/${triggerId}/fire`);
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {})
    }),
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

describe('/api/plan-triggers/:triggerId/fire', () => {
  it('POST 200 fires trigger with its planId', async () => {
    const trigger = addTrigger({
      event: 'plan.completed',
      action: 'console.log',
      actionConfig: {},
      planId: 'p-1'
    });
    const res = await run(POST as unknown as AnyHandler, eventFor(trigger.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fired).toBe(true);
    expect(body.triggerId).toBe(trigger.id);
    expect(body.planId).toBe('p-1');
  });

  it('POST 200 fires wildcard trigger with body planId override', async () => {
    const trigger = addTrigger({
      event: 'task.created',
      action: 'console.log',
      actionConfig: {}
    });
    const res = await run(POST as unknown as AnyHandler, eventFor(trigger.id, { planId: 'p-override' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fired).toBe(true);
    expect(body.planId).toBe('p-override');
  });

  it('POST 400 when wildcard trigger has no planId', async () => {
    const trigger = addTrigger({
      event: 'task.created',
      action: 'console.log',
      actionConfig: {}
    });
    const res = await run(POST as unknown as AnyHandler, eventFor(trigger.id));
    expect(res.status).toBe(400);
  });

  it('POST 400 on empty triggerId', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(400);
  });

  it('POST 404 for unknown trigger', async () => {
    const res = await run(POST as unknown as AnyHandler, eventFor('no-such-trigger'));
    expect(res.status).toBe(404);
  });

  it('POST 401 without admin bearer', async () => {
    const trigger = addTrigger({
      event: 'plan.completed',
      action: 'console.log',
      actionConfig: {},
      planId: 'p-1'
    });
    const res = await run(POST as unknown as AnyHandler, eventFor(trigger.id, {}, null));
    expect(res.status).toBe(401);
  });
});
