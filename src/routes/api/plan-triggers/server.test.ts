import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import {
  addTrigger,
  listTriggers,
  _resetPlanTriggerStoreForTests
} from '\$lib/server/planTriggerStore';
import { GET, POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'trigger-admin-token';

type AnyHandler = (event: unknown) => unknown;

function getReq(search = '', token: string | null = null): Parameters<typeof GET>[0] {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    request: new Request('http://localhost/api/plan-triggers' + search, { headers }),
    url: new URL('http://localhost/api/plan-triggers' + search)
  } as Parameters<typeof GET>[0];
}

function postReq(body: unknown, token: string | null = ADMIN_TOKEN): Parameters<typeof POST>[0] {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    request: new Request('http://localhost/api/plan-triggers', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    url: new URL('http://localhost/api/plan-triggers')
  } as Parameters<typeof POST>[0];
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

describe('/api/plan-triggers', () => {
  it('GET lists triggers without leaking actionConfig to non-admin readers', async () => {
    addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: { message: 'done' } });
    const res = await run(GET as unknown as AnyHandler, getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggers.length).toBe(1);
    expect(body.triggers[0].event).toBe('plan.completed');
    expect(body.triggers[0].actionConfig).toEqual({});
    expect(body.triggers[0].actionConfigRedacted).toBe(true);
  });

  it('GET includes actionConfig for admin bearer readers', async () => {
    addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: { message: 'done' } });
    const res = await run(GET as unknown as AnyHandler, getReq('', ADMIN_TOKEN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggers[0].actionConfig).toEqual({ message: 'done' });
    expect(body.triggers[0].actionConfigRedacted).toBeUndefined();
  });

  it('GET filters by planId', async () => {
    addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: {}, planId: 'p1' });
    addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: {}, planId: 'p2' });
    addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: {} }); // wildcard
    const res = await run(GET as unknown as AnyHandler, getReq('?planId=p1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggers.length).toBe(2); // p1 + wildcard
  });

  it('GET filters by event', async () => {
    addTrigger({ event: 'plan.completed', action: 'console.log', actionConfig: {} });
    addTrigger({ event: 'plan.archived', action: 'console.log', actionConfig: {} });
    const res = await run(GET as unknown as AnyHandler, getReq('?event=plan.archived'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggers.length).toBe(1);
    expect(body.triggers[0].event).toBe('plan.archived');
  });

  it('GET rejects invalid event filter', async () => {
    const res = await run(GET as unknown as AnyHandler, getReq('?event=not_real'));
    expect(res.status).toBe(400);
  });

  it('POST creates trigger when admin', async () => {
    const res = await run(POST as unknown as AnyHandler, postReq({
      event: 'plan.completed',
      action: 'room.message',
      actionConfig: { messageTemplate: 'Plan done' }
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.trigger.event).toBe('plan.completed');
    expect(body.trigger.action).toBe('room.message');
  });

  it('POST accepts every action exposed by the trigger builder option set', async () => {
    const webhook = await run(POST as unknown as AnyHandler, postReq({
      event: 'plan.completed',
      action: 'webhook.post',
      actionConfig: { url: 'https://example.test/hook/{planId}' }
    }));
    expect(webhook.status).toBe(201);
    expect((await webhook.json()).trigger.action).toBe('webhook.post');

    const task = await run(POST as unknown as AnyHandler, postReq({
      event: 'task.blocked',
      action: 'task.create',
      actionConfig: { subject: 'Follow-up for {taskSubject}', planId: 'same' }
    }));
    expect(task.status).toBe(201);
    expect((await task.json()).trigger.action).toBe('task.create');
  });

  it('POST 401 without admin bearer', async () => {
    const res = await run(POST as unknown as AnyHandler, postReq({
      event: 'plan.completed',
      action: 'console.log'
    }, null));
    expect(res.status).toBe(401);
  });

  it('POST 400 on invalid event', async () => {
    const res = await run(POST as unknown as AnyHandler, postReq({
      event: 'not_real',
      action: 'console.log'
    }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('task.created');
  });

  it('POST 400 on invalid action', async () => {
    const res = await run(POST as unknown as AnyHandler, postReq({
      event: 'plan.completed',
      action: 'not_real'
    }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('webhook.post');
    expect(text).toContain('task.create');
  });
});
