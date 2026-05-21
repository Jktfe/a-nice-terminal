import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  createTask as createPlanTask,
  deleteTask,
  _resetTaskStoreForTests
} from '$lib/server/taskStore';
import { createTask as createRoomTask } from '$lib/server/tasksStore';
import { createPlan, _resetPlanStoreForTests } from '$lib/server/planStore';
import { attachPlanToRoom, _resetPlanRoomLinksForTests } from '$lib/server/planRoomLinkStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(roomId: string): Parameters<typeof GET>[0] {
  return {
    params: { roomId }
  } as Parameters<typeof GET>[0];
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
  resetChatRoomStoreForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  _resetPlanRoomLinksForTests();
});

afterEach(() => {
  _resetPlanRoomLinksForTests();
  _resetPlanStoreForTests();
  _resetTaskStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/chat-rooms/:roomId/tasks', () => {
  it('GET returns plan-linked tasks and standalone room tasks in route payload order', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const plan = createPlan({ id: 'p1', title: 'Plan A', createdBy: '@you' });
    attachPlanToRoom({ planId: plan.id, roomId: room.id });
    createPlanTask({ id: 't-low', subject: 'Low priority plan task', planId: plan.id, priority: 3 });
    createPlanTask({ id: 't-high', subject: 'High priority plan task', planId: plan.id, priority: 1 });
    createPlanTask({ id: 't-other-plan', subject: 'Other plan task', planId: 'other-plan', priority: 0 });
    createRoomTask({ id: 't-room', title: 'Standalone room task', roomId: room.id });
    createRoomTask({ id: 't-other-room', title: 'Other room task', roomId: 'other-room' });

    const res = await run(GET as unknown as AnyHandler, eventFor(room.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual([
      't-high',
      't-low',
      't-room'
    ]);
    expect(body.tasks.find((task: { id: string }) => task.id === 't-high').planTitle).toBe('Plan A');
    expect(body.tasks.find((task: { id: string }) => task.id === 't-room').planTitle).toBeNull();
  });

  it('GET excludes deleted tasks from attached-plan and standalone room feeds', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const plan = createPlan({ id: 'p1', title: 'Plan A', createdBy: '@you' });
    attachPlanToRoom({ planId: plan.id, roomId: room.id });
    createPlanTask({ id: 't-live-plan', subject: 'Live plan task', planId: plan.id, status: 'pending' });
    createPlanTask({ id: 't-deleted-plan', subject: 'Deleted plan task', planId: plan.id });
    createRoomTask({ id: 't-live-room', title: 'Live room task', roomId: room.id });
    createRoomTask({ id: 't-deleted-room', title: 'Deleted room task', roomId: room.id });
    deleteTask('t-deleted-plan');
    deleteTask('t-deleted-room');

    const res = await run(GET as unknown as AnyHandler, eventFor(room.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual([
      't-live-plan',
      't-live-room'
    ]);
  });

  it('GET returns empty array when room has no linked plans or tasks', async () => {
    const room = createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
    const res = await run(GET as unknown as AnyHandler, eventFor(room.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toEqual([]);
  });


  it('GET includes standalone room tasks (plan_id IS NULL)', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    createRoomTask({ id: 't-standalone', title: 'Standalone', roomId: room.id });

    const res = await run(GET as unknown as AnyHandler, eventFor(room.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(['t-standalone']);
  });

  it('GET orders tasks by priority then created_at', async () => {
    const room = createChatRoom({ name: 'test', whoCreatedIt: '@you' });
    const plan = createPlan({ id: 'p1', title: 'Plan', createdBy: '@you' });
    attachPlanToRoom({ planId: plan.id, roomId: room.id });
    createPlanTask({ id: 't-low', subject: 'Low', planId: plan.id, priority: 2, status: 'pending' });
    createPlanTask({ id: 't-high', subject: 'High', planId: plan.id, priority: 1, status: 'pending' });
    createPlanTask({ id: 't-none', subject: 'None', planId: plan.id, priority: null, status: 'pending' });

    const res = await run(GET as unknown as AnyHandler, eventFor(room.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks[0].id).toBe('t-high');
    expect(body.tasks[1].id).toBe('t-low');
    expect(body.tasks[2].id).toBe('t-none');
  });

  it('GET 400s for missing roomId', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor(''));
    expect(res.status).toBe(400);
  });
});
