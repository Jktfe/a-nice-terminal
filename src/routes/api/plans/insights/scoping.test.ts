/**
 * rv1 data-scoping privacy test — GET /api/plans/insights.
 *
 * This is a server-wide cross-plan aggregate that can't be partitioned per
 * room, so it is admin-bearer only (containment), mirroring /api/tasks'
 * no-room aggregate path. Proves:
 *   - a non-admin room caller is rejected (401, no global analytics leak),
 *   - an unauthenticated caller is rejected (401),
 *   - admin-bearer still gets the insights.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createTask as createLegacyTask } from '$lib/server/taskStore';
import { createSession } from '$lib/server/antSessionStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

const ADMIN_TOKEN_FOR_TESTS = 'plan-insights-scoping-admin-token';
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

function eventFor(opts: { admin?: boolean; sessionId?: string; cookie?: string } = {}): AnyEvent {
  const url = new URL('http://localhost/api/plans/insights');
  const headers: Record<string, string> = {};
  if (opts.admin) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  if (opts.sessionId) headers['x-ant-session-id'] = opts.sessionId;
  if (opts.cookie) headers.cookie = opts.cookie;
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

function seed() {
  const room = createChatRoom({ name: 'Room A', whoCreatedIt: '@reader-a' });
  createLegacyTask({ id: 'task_a', subject: 'A task', planId: 'plan_a' });
  const sessionA = createSession({
    id: 'sess-reader-a',
    kind: 'local-cli',
    label: '@reader-a',
    terminalId: 't-reader-a'
  });
  return { room, sessionA };
}

function operatorCookie(): string {
  const room = createChatRoom({ name: 'operator insights', whoCreatedIt: '@JWPK' });
  const terminal = upsertTerminal({ pid: 82_001, pid_start: 'plans-insights-operator', name: 'plans-insights-operator' });
  addMembership({ room_id: room.id, handle: '@JWPK', terminal_id: terminal.id });
  const session = createBrowserSession({ roomId: room.id, authorHandle: '@JWPK' });
  if (!session) throw new Error('createBrowserSession returned null');
  return `ant_browser_session=${session.browserSessionSecret}`;
}

describe('GET /api/plans/insights containment', () => {
  it('rejects a non-admin room caller (no global aggregate leak)', async () => {
    const { sessionA } = seed();
    const res = await run(eventFor({ sessionId: sessionA.id }));
    expect(res.status).toBe(401);
  });
  it('rejects an unauthenticated caller', async () => {
    seed();
    const res = await run(eventFor());
    expect(res.status).toBe(401);
  });
  it('admin-bearer still gets insights (containment)', async () => {
    seed();
    const res = await run(eventFor({ admin: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).insights).toBeTruthy();
  });
  it('configured operator browser session gets insights for the UI dashboard', async () => {
    seed();
    const res = await run(eventFor({ cookie: operatorCookie() }));
    expect(res.status).toBe(200);
    expect((await res.json()).insights).toBeTruthy();
  });
});
