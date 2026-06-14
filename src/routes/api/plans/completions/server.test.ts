import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  _resetPlanStoreForTests,
  archivePlan,
  createPlan,
  softDeletePlan
} from '$lib/server/planStore';
import { _resetTaskStoreForTests, createTask } from '$lib/server/taskStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
// rv1 data-scoping fix: /api/plans/completions is now caller-scoped. These
// pre-existing tests assert the full server-wide feed, so they authenticate
// as admin-bearer (containment retains full access, like /api/tasks).
const ADMIN_TOKEN_FOR_TESTS = 'plans-completions-server-test-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
  resetIdentityDbForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
});

afterEach(() => {
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function req(search = ''): Parameters<typeof GET>[0] {
  const url = new URL('http://x/api/plans/completions' + search);
  return {
    url,
    request: new Request(url.toString(), {
      headers: { authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}` }
    })
  } as Parameters<typeof GET>[0];
}

function seedPlans() {
  createPlan({ id: 'plan-active', title: 'Active Plan' });
  createTask({ id: 't-done', subject: 'Done', status: 'completed', planId: 'plan-active' });
  createTask({ id: 't-open', subject: 'Open', status: 'pending', planId: 'plan-active' });
  createTask({ id: 't-standalone', subject: 'Standalone' });

  createPlan({ id: 'plan-empty', title: 'Empty Active Plan' });

  createPlan({ id: 'plan-archived', title: 'Archived Plan' });
  archivePlan('plan-archived');

  createPlan({ id: 'plan-deleted', title: 'Deleted Plan' });
  softDeletePlan('plan-deleted');
}

describe('GET /api/plans/completions', () => {
  it('defaults to task-derived plans and excludes standalone tasks', async () => {
    seedPlans();

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.plans).toEqual([
      {
        planId: 'plan-active',
        title: 'Active Plan',
        total: 2,
        completed: 1,
        pct: 0.5
      }
    ]);
  });

  it('returns active explicit zero-task plans for the active feed', async () => {
    seedPlans();

    const body = await (await GET(req('?active=1'))).json();

    expect(body.plans.map((plan: { planId: string }) => plan.planId)).toEqual([
      'plan-active',
      'plan-empty'
    ]);
    expect(body.plans.find((plan: { planId: string }) => plan.planId === 'plan-empty')).toMatchObject({
      title: 'Empty Active Plan',
      total: 0,
      completed: 0,
      pct: 0
    });
  });

  it('returns archived and deleted feeds from plan lifecycle state', async () => {
    seedPlans();

    const archived = await (await GET(req('?archived=1'))).json();
    expect(archived.plans).toEqual([
      expect.objectContaining({ planId: 'plan-archived', title: 'Archived Plan' })
    ]);

    const deleted = await (await GET(req('?deleted=1'))).json();
    expect(deleted.plans).toEqual([
      expect.objectContaining({ planId: 'plan-deleted', title: 'Deleted Plan' })
    ]);
  });

  it('gives deleted filter precedence over archived and active flags', async () => {
    seedPlans();

    const body = await (await GET(req('?deleted=1&archived=1&active=1'))).json();

    expect(body.plans.map((plan: { planId: string }) => plan.planId)).toEqual(['plan-deleted']);
  });
});
