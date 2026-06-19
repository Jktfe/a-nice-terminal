import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createPlan, _resetPlanStoreForTests } from '$lib/server/planStore';
import { projectPlanEvents, resetPlanModeStoreForTests } from '$lib/server/planModeStore';
import { POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'proposal-adopt-admin-token';

type AnyHandler = (event: unknown) => unknown;

function eventFor(body: unknown, authenticated = true) {
  const url = new URL('http://localhost/api/plans/proposals/adopt');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authenticated) headers.authorization = `Bearer ${ADMIN_TOKEN}`;
  return {
    request: new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
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
  _resetPlanStoreForTests();
  resetPlanModeStoreForTests();
});

afterEach(() => {
  resetPlanModeStoreForTests();
  _resetPlanStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('POST /api/plans/proposals/adopt', () => {
  it('rejects anonymous adoption before appending a plan decision', async () => {
    createPlan({ id: 'plan-a', title: 'Plan A' });

    const response = await run(
      POST as unknown as AnyHandler,
      eventFor({ planId: 'plan-a', taskId: 'task-a', ref: 'proposal:one', label: 'Option one' }, false)
    );

    expect(response.status).toBe(401);
    expect(projectPlanEvents('plan-a')).toEqual([]);
  });

  it('appends a plan decision for an authenticated operator-like caller', async () => {
    createPlan({ id: 'plan-a', title: 'Plan A' });

    const response = await run(
      POST as unknown as AnyHandler,
      eventFor({ planId: 'plan-a', taskId: 'task-a', ref: 'proposal:one', label: 'Option one' })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision).toMatchObject({
      plan_id: 'plan-a',
      parent_id: 'task-a',
      kind: 'plan_decision',
      title: 'Adopt: Option one'
    });
    expect(projectPlanEvents('plan-a')).toHaveLength(1);
  });
});
