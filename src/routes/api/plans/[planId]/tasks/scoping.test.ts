/**
 * rv1 data-scoping privacy test — GET /api/plans/:planId/tasks.
 *
 * Pre-fix any caller could read any plan's tasks. Proves room-scoping:
 *   (a) caller in room A does NOT see room B's tasks (404),
 *   (b) caller in room A DOES see room A's tasks (200),
 *   (c) admin-bearer sees any plan's tasks,
 *   (d) unauthenticated → 401.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createTask as createLegacyTask } from '$lib/server/taskStore';
import { attachPlanToRoom } from '$lib/server/planRoomLinkStore';
import { createSession } from '$lib/server/antSessionStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'plan-tasks-scoping-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ORIGINAL_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyEvent = Parameters<typeof GET>[0];

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  if (ORIGINAL_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = ORIGINAL_DB_PATH;
});
beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

function eventFor(planId: string, opts: { admin?: boolean; sessionId?: string } = {}): AnyEvent {
  const url = new URL(`http://localhost/api/plans/${planId}/tasks`);
  const headers: Record<string, string> = {};
  if (opts.admin) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  if (opts.sessionId) headers['x-ant-session-id'] = opts.sessionId;
  return {
    request: new Request(url.toString(), { headers }),
    params: { planId },
    url
  } as unknown as AnyEvent;
}

async function run(event: AnyEvent): Promise<Response> {
  try {
    return (await GET(event as never)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

function seed() {
  const roomA = createChatRoom({ name: 'Room A', whoCreatedIt: '@reader-a' });
  const roomB = createChatRoom({ name: 'Room B', whoCreatedIt: '@reader-b' });
  createLegacyTask({ id: 'task_a', subject: 'A task', planId: 'plan_a' });
  createLegacyTask({ id: 'task_b', subject: 'B task secret', planId: 'plan_b' });
  attachPlanToRoom({ planId: 'plan_a', roomId: roomA.id });
  attachPlanToRoom({ planId: 'plan_b', roomId: roomB.id });
  const sessionA = createSession({
    id: 'sess-reader-a',
    kind: 'local-cli',
    label: '@reader-a',
    terminalId: 't-reader-a'
  });
  return { sessionA };
}

describe('GET /api/plans/:planId/tasks data scoping', () => {
  it('(a) caller in room A does NOT see room B tasks (404)', async () => {
    const { sessionA } = seed();
    const res = await run(eventFor('plan_b', { sessionId: sessionA.id }));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('B task secret');
  });
  it('(b) caller in room A DOES see room A tasks (200)', async () => {
    const { sessionA } = seed();
    const res = await run(eventFor('plan_a', { sessionId: sessionA.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.map((t: { id: string }) => t.id)).toContain('task_a');
  });
  it('(c) admin-bearer sees any plan tasks', async () => {
    seed();
    const res = await run(eventFor('plan_b', { admin: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.map((t: { id: string }) => t.id)).toContain('task_b');
  });
  it('(d) unauthenticated → 401', async () => {
    seed();
    const res = await run(eventFor('plan_a'));
    expect(res.status).toBe(401);
  });
});
