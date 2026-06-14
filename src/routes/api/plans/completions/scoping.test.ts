/**
 * rv1 data-scoping privacy test — GET /api/plans/completions.
 *
 * Confirmed leak (pre-fix): this feed returned EVERY plan server-wide
 * regardless of caller. These tests prove the fix:
 *   (a) a caller in room A does NOT see room B's plans,
 *   (b) a caller in room A DOES still see room A's plans,
 *   (c) admin-bearer still sees all (containment),
 *   (d) an unauthenticated caller gets 401 (fail closed).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createTask as createLegacyTask } from '$lib/server/taskStore';
import { attachPlanToRoom } from '$lib/server/planRoomLinkStore';
import { createSession } from '$lib/server/antSessionStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'plans-completions-scoping-admin-token';
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

function eventFor(opts: { admin?: boolean; sessionId?: string } = {}): AnyEvent {
  const url = new URL('http://localhost/api/plans/completions');
  const headers: Record<string, string> = {};
  if (opts.admin) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  if (opts.sessionId) headers['x-ant-session-id'] = opts.sessionId;
  return {
    request: new Request(url.toString(), { headers }),
    params: {},
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

/** Build room A (creator @reader-a) + room B (creator @reader-b), each
 *  hosting a plan with one task, and a session bound to @reader-a. */
function seedTwoRoomsWithPlans() {
  const roomA = createChatRoom({ name: 'Room A', whoCreatedIt: '@reader-a' });
  const roomB = createChatRoom({ name: 'Room B', whoCreatedIt: '@reader-b' });

  createLegacyTask({ id: 'task_a', subject: 'A task', planId: 'plan_a' });
  createLegacyTask({ id: 'task_b', subject: 'B task', planId: 'plan_b' });
  attachPlanToRoom({ planId: 'plan_a', roomId: roomA.id });
  attachPlanToRoom({ planId: 'plan_b', roomId: roomB.id });

  const sessionA = createSession({
    id: 'sess-reader-a',
    kind: 'local-cli',
    label: '@reader-a',
    terminalId: 't-reader-a'
  });
  return { roomA, roomB, sessionA };
}

describe('GET /api/plans/completions data scoping', () => {
  it('(a) caller in room A does NOT see room B plans', async () => {
    const { sessionA } = seedTwoRoomsWithPlans();
    const res = await run(eventFor({ sessionId: sessionA.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const planIds = body.plans.map((p: { planId: string }) => p.planId);
    expect(planIds).not.toContain('plan_b');
  });

  it('(b) caller in room A DOES still see room A plans', async () => {
    const { sessionA } = seedTwoRoomsWithPlans();
    const res = await run(eventFor({ sessionId: sessionA.id }));
    const body = await res.json();
    const planIds = body.plans.map((p: { planId: string }) => p.planId);
    expect(planIds).toContain('plan_a');
  });

  it('(c) admin-bearer still sees ALL plans (containment)', async () => {
    seedTwoRoomsWithPlans();
    const res = await run(eventFor({ admin: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const planIds = body.plans.map((p: { planId: string }) => p.planId);
    expect(planIds).toContain('plan_a');
    expect(planIds).toContain('plan_b');
  });

  it('(d) unauthenticated caller is rejected before any plan leaks', async () => {
    seedTwoRoomsWithPlans();
    const res = await run(eventFor());
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('plan_b');
  });
});
