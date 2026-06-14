import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { attachPlanToRoom, _resetPlanRoomLinksForTests } from '$lib/server/planRoomLinkStore';
import { createPlan, _resetPlanStoreForTests } from '$lib/server/planStore';
import { addDependency, createTask, _resetTaskStoreForTests } from '$lib/server/taskStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
// rv1 data-scoping fix: /api/plans/insights is a server-wide aggregate, now
// admin-bearer only (containment). These tests assert that aggregate, so they
// authenticate as admin-bearer.
const ADMIN_TOKEN_FOR_TESTS = 'plan-insights-server-test-admin-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  _resetPlanRoomLinksForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
});

afterEach(() => {
  _resetPlanRoomLinksForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function req(): Parameters<typeof GET>[0] {
  return {
    request: new Request('http://x/api/plans/insights', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}` }
    })
  } as Parameters<typeof GET>[0];
}

describe('GET /api/plans/insights', () => {
  it('returns empty-state insights with a short public cache header', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=10');
    const body = await res.json();

    expect(body.insights).toMatchObject({
      plans: {
        total: 0,
        active: 0,
        archived: 0,
        deletedSoft: 0,
        avgCompletionPctActive: 0
      },
      tasks: {
        total: 0,
        byStatus: {
          pending: 0,
          in_progress: 0,
          blocked: 0,
          completed: 0
        },
        standalone: 0
      },
      duration: null,
      topRooms: [],
      topAgents: [],
      mostBlockedTasks: [],
      dependencies: { taskCount: 0, edgeCount: 0 }
    });
    expect(body.insights.generatedAtMs).toEqual(expect.any(Number));
  });

  it('projects seeded plan, room, agent, duration, and dependency aggregates', async () => {
    createPlan({ id: 'plan-a', title: 'Alpha Plan' });
    createPlan({ id: 'plan-b', title: 'Beta Plan' });
    const room = createChatRoom({ name: 'delivery room', whoCreatedIt: '@tester' });
    attachPlanToRoom({ planId: 'plan-a', roomId: room.id });
    attachPlanToRoom({ planId: 'plan-b', roomId: room.id });

    createTask({
      id: 'blocker-1',
      subject: 'Blocking prerequisite',
      planId: 'plan-a',
      assignedAgent: '@evolveantcodex'
    });
    createTask({
      id: 'done-1',
      subject: 'Finished slice',
      planId: 'plan-a',
      status: 'completed',
      priority: 1,
      assignedAgent: '@evolveantcodex',
      startedAtMs: 1000,
      endedAtMs: 3000
    });
    createTask({
      id: 'waiting-1',
      subject: 'Waiting slice',
      planId: 'plan-b',
      status: 'blocked',
      priority: 2,
      assignedAgent: '@evolveantsvelte'
    });
    addDependency('waiting-1', 'blocker-1');

    const body = await (await GET(req())).json();
    const insights = body.insights;

    expect(insights.plans).toMatchObject({
      total: 2,
      active: 2,
      archived: 0,
      deletedSoft: 0
    });
    expect(insights.tasks).toMatchObject({
      total: 3,
      byStatus: {
        pending: 1,
        in_progress: 0,
        blocked: 1,
        completed: 1
      },
      withTimestamps: 1,
      standalone: 0
    });
    expect(insights.duration).toMatchObject({
      measuredCount: 1,
      totalMs: 2000,
      avgMs: 2000,
      medianMs: 2000
    });
    expect(insights.topRooms[0]).toMatchObject({
      roomId: room.id,
      roomName: 'delivery room',
      planCount: 2
    });
    expect(insights.topAgents[0]).toMatchObject({
      agent: '@evolveantcodex',
      completed: 1,
      total: 2
    });
    expect(insights.topPlans.byCompletedCount[0]).toMatchObject({
      planId: 'plan-a',
      title: 'Alpha Plan',
      completed: 1,
      total: 2,
      pct: 0.5
    });
    expect(insights.mostBlockedTasks[0]).toMatchObject({
      taskId: 'waiting-1',
      subject: 'Waiting slice',
      planId: 'plan-b',
      blockedByCount: 1
    });
    expect(insights.dependencies).toEqual({ taskCount: 3, edgeCount: 1 });
  });
});
