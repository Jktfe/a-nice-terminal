/**
 * rv1 data-scoping privacy test — GET /api/asks/:askId.
 *
 * Pre-fix this returned ANY ask by id with no auth. Proves the fix:
 *   (a) caller in room A does NOT see room B's ask (404),
 *   (b) caller in room A DOES see room A's ask (200),
 *   (c) admin-bearer sees any ask (containment),
 *   (d) unauthenticated → 401.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { openAskInRoom } from '$lib/server/askStore';
import { createSession } from '$lib/server/antSessionStore';
import { addMember } from '$lib/server/membershipStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'asks-single-scoping-admin-token';
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

function eventFor(askId: string, opts: { admin?: boolean; sessionId?: string } = {}): AnyEvent {
  const url = new URL(`http://localhost/api/asks/${askId}`);
  const headers: Record<string, string> = {};
  if (opts.admin) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  if (opts.sessionId) headers['x-ant-session-id'] = opts.sessionId;
  return {
    request: new Request(url.toString(), { headers }),
    params: { askId },
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
  const askA = openAskInRoom({
    roomId: roomA.id,
    openedByHandle: '@reader-a',
    title: 'Ask A',
    body: 'room A decision'
  });
  const askB = openAskInRoom({
    roomId: roomB.id,
    openedByHandle: '@reader-b',
    title: 'Ask B secret',
    body: 'room B decision secret'
  });
  const sessionA = createSession({
    id: 'sess-reader-a',
    kind: 'local-cli',
    label: '@reader-a',
    terminalId: 't-reader-a'
  });
  // Bind the session to room A (room-scoped read gate needs the membership
  // lease, not just creator mirroring) — @reader-a is a member of A, NOT B.
  addMember(roomA.id, '@reader-a', sessionA.id);
  return { askA, askB, sessionA };
}

describe('GET /api/asks/:askId data scoping', () => {
  it('(a) caller in room A does NOT see room B ask (denied)', async () => {
    const { askB, sessionA } = seed();
    const res = await run(eventFor(askB.id, { sessionId: sessionA.id }));
    // Denied either as 401 (no identity for room B) or 404 (resolved but
    // not a member). Both fail closed; the secret must never leak.
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain('room B decision secret');
  });
  it('(b) caller in room A DOES see room A ask (200)', async () => {
    const { askA, sessionA } = seed();
    const res = await run(eventFor(askA.id, { sessionId: sessionA.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).ask.id).toBe(askA.id);
  });
  it('(c) admin-bearer sees any ask (containment)', async () => {
    const { askB } = seed();
    const res = await run(eventFor(askB.id, { admin: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).ask.id).toBe(askB.id);
  });
  it('(d) unauthenticated → 401', async () => {
    const { askA } = seed();
    const res = await run(eventFor(askA.id));
    expect(res.status).toBe(401);
  });
});
