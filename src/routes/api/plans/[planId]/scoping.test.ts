/**
 * rv1 data-scoping privacy test — GET /api/plans/:planId (single plan).
 *
 * Pre-fix this returned ANY plan by id with no auth. Proves:
 *   (a) caller in room A does NOT see room B's plan (404),
 *   (b) caller in room A DOES see room A's plan (200),
 *   (c) admin-bearer sees any plan,
 *   (d) unauthenticated → 401.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createPlan } from '$lib/server/planStore';
import { attachPlanToRoom } from '$lib/server/planRoomLinkStore';
import { createSession } from '$lib/server/antSessionStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'plan-single-scoping-admin-token';
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
  const url = new URL(`http://localhost/api/plans/${planId}`);
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
  createPlan({ id: 'plan_a', title: 'Plan A', description: null, createdBy: null });
  createPlan({ id: 'plan_b', title: 'Plan B', description: null, createdBy: null });
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

describe('GET /api/plans/:planId data scoping', () => {
  it('(a) caller in room A does NOT see room B plan (404)', async () => {
    const { sessionA } = seed();
    const res = await run(eventFor('plan_b', { sessionId: sessionA.id }));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Plan B');
  });
  it('(b) caller in room A DOES see room A plan (200)', async () => {
    const { sessionA } = seed();
    const res = await run(eventFor('plan_a', { sessionId: sessionA.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).plan.id).toBe('plan_a');
  });
  it('(c) admin-bearer sees any plan', async () => {
    seed();
    const res = await run(eventFor('plan_b', { admin: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).plan.id).toBe('plan_b');
  });
  it('(d) unauthenticated → 401', async () => {
    seed();
    const res = await run(eventFor('plan_a'));
    expect(res.status).toBe(401);
  });
});
