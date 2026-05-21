import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { _resetPlanStoreForTests, createPlan } from '$lib/server/planStore';
import { _resetTaskStoreForTests, createTask, deleteTask } from '$lib/server/taskStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
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
});

function req(planId: string): Parameters<typeof GET>[0] {
  return {
    params: { planId }
  } as Parameters<typeof GET>[0];
}

describe('GET /api/plans/:planId/tasks', () => {
  it('returns ordered non-deleted tasks plus completion for the plan', async () => {
    createPlan({ id: 'plan-a', title: 'Plan A' });
    createTask({ id: 't-null', subject: 'Null priority', planId: 'plan-a' });
    createTask({ id: 't-low', subject: 'Low priority', planId: 'plan-a', priority: 3, status: 'completed' });
    createTask({ id: 't-high', subject: 'High priority', planId: 'plan-a', priority: 1 });
    createTask({ id: 't-other', subject: 'Other plan', planId: 'plan-b', priority: 0 });
    createTask({ id: 't-deleted', subject: 'Deleted', planId: 'plan-a', priority: 2 });
    deleteTask('t-deleted');

    const res = await GET(req('plan-a'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.planId).toBe('plan-a');
    expect(body.completion).toEqual({
      planId: 'plan-a',
      title: 'Plan A',
      total: 3,
      completed: 1,
      pct: 1 / 3
    });
    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual([
      't-high',
      't-low',
      't-null'
    ]);
  });

  it('returns an empty task feed with zero completion for unknown plans', async () => {
    const res = await GET(req('missing-plan'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toEqual({
      planId: 'missing-plan',
      completion: {
        planId: 'missing-plan',
        title: null,
        total: 0,
        completed: 0,
        pct: 0
      },
      tasks: []
    });
  });
});
