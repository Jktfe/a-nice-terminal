/**
 * rv1 data-scoping privacy test — GET /api/chat-rooms/:roomId/artefacts.
 *
 * Pre-fix the artefacts list had NO read gate — any caller could read any
 * room's artefacts. Proves the fix:
 *   (a) caller in room A does NOT see room B's artefacts (404),
 *   (b) caller in room A DOES see room A's artefacts (200),
 *   (c) admin-bearer sees any room's artefacts (containment),
 *   (d) unauthenticated → 401.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createArtefactInRoom } from '$lib/server/chatRoomArtefactStore';
import { createSession } from '$lib/server/antSessionStore';
import { addMember } from '$lib/server/membershipStore';
import { resetIdentityDbForTests } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'artefacts-scoping-admin-token';
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

function eventFor(roomId: string, opts: { admin?: boolean; sessionId?: string } = {}): AnyEvent {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/artefacts`);
  const headers: Record<string, string> = {};
  if (opts.admin) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  if (opts.sessionId) headers['x-ant-session-id'] = opts.sessionId;
  return {
    request: new Request(url.toString(), { headers }),
    params: { roomId },
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
  createArtefactInRoom({
    roomId: roomA.id,
    kind: 'doc',
    title: 'Artefact A',
    refUrl: null,
    summary: null,
    createdBy: '@reader-a'
  });
  createArtefactInRoom({
    roomId: roomB.id,
    kind: 'doc',
    title: 'Artefact B secret',
    refUrl: null,
    summary: null,
    createdBy: '@reader-b'
  });
  const sessionA = createSession({
    id: 'sess-reader-a',
    kind: 'local-cli',
    label: '@reader-a',
    terminalId: 't-reader-a'
  });
  // Bind the session to room A only — @reader-a is a member of A, NOT B.
  addMember(roomA.id, '@reader-a', sessionA.id);
  return { roomA, roomB, sessionA };
}

describe('GET /api/chat-rooms/:roomId/artefacts data scoping', () => {
  it('(a) caller in room A does NOT see room B artefacts (denied)', async () => {
    const { roomB, sessionA } = seed();
    const res = await run(eventFor(roomB.id, { sessionId: sessionA.id }));
    // Fail closed: denied as 401 (no room-B identity) or 404 (not a member).
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain('Artefact B secret');
  });
  it('(b) caller in room A DOES see room A artefacts (200)', async () => {
    const { roomA, sessionA } = seed();
    const res = await run(eventFor(roomA.id, { sessionId: sessionA.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artefacts.map((a: { title: string }) => a.title)).toContain('Artefact A');
  });
  it('(c) admin-bearer sees any room artefacts (containment)', async () => {
    const { roomB } = seed();
    const res = await run(eventFor(roomB.id, { admin: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artefacts.map((a: { title: string }) => a.title)).toContain('Artefact B secret');
  });
  it('(d) unauthenticated → 401', async () => {
    const { roomA } = seed();
    const res = await run(eventFor(roomA.id));
    expect(res.status).toBe(401);
  });
});
