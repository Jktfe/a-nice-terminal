/**
 * rv1 data-scoping privacy test — GET /api/plans/evidence.
 *
 * Pre-fix this returned EVERY evidence entry server-wide (public-read).
 * Proves the fix:
 *   (a) caller in room A does NOT see room B's evidence (and the stats
 *       counter is recomputed from the scoped rows, not the global total),
 *   (b) caller in room A DOES see room A's evidence,
 *   (c) admin-bearer sees all evidence (containment),
 *   (d) unauthenticated → 401.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createTask as createLegacyTask } from '$lib/server/taskStore';
import { attachPlanToRoom } from '$lib/server/planRoomLinkStore';
import { createSession } from '$lib/server/antSessionStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'plan-evidence-scoping-admin-token';
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
  const url = new URL('http://localhost/api/plans/evidence');
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

function seed() {
  const roomA = createChatRoom({ name: 'Room A', whoCreatedIt: '@reader-a' });
  const roomB = createChatRoom({ name: 'Room B', whoCreatedIt: '@reader-b' });
  createLegacyTask({
    id: 'task_a',
    subject: 'A task',
    planId: 'plan_a',
    evidence: [{ kind: 'url', ref: 'https://a.example/evidence-a', label: 'evidence-a' }]
  });
  createLegacyTask({
    id: 'task_b',
    subject: 'B task',
    planId: 'plan_b',
    evidence: [{ kind: 'url', ref: 'https://b.example/evidence-b-secret', label: 'evidence-b' }]
  });
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

describe('GET /api/plans/evidence data scoping', () => {
  it('(a) caller in room A does NOT see room B evidence; stats reflect scope', async () => {
    const { sessionA } = seed();
    const res = await run(eventFor({ sessionId: sessionA.id }));
    expect(res.status).toBe(200);
    const text = await res.clone().text();
    expect(text).not.toContain('evidence-b-secret');
    const body = await res.json();
    expect(body.evidence.map((e: { ref: string }) => e.ref)).not.toContain(
      'https://b.example/evidence-b-secret'
    );
    // Stats counter must NOT leak the global total (2) — only the scoped row.
    expect(body.stats.total).toBe(1);
  });
  it('(b) caller in room A DOES see room A evidence', async () => {
    const { sessionA } = seed();
    const body = await (await run(eventFor({ sessionId: sessionA.id }))).json();
    expect(body.evidence.map((e: { ref: string }) => e.ref)).toContain(
      'https://a.example/evidence-a'
    );
  });
  it('(c) admin-bearer sees ALL evidence (containment)', async () => {
    seed();
    const body = await (await run(eventFor({ admin: true }))).json();
    const refs = body.evidence.map((e: { ref: string }) => e.ref);
    expect(refs).toContain('https://a.example/evidence-a');
    expect(refs).toContain('https://b.example/evidence-b-secret');
    expect(body.stats.total).toBe(2);
  });
  it('(d) unauthenticated → 401', async () => {
    seed();
    const res = await run(eventFor());
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('evidence-b-secret');
  });
});
