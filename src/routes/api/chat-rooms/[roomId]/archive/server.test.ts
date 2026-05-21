import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, POST } from './+server';
import {
  createChatRoom,
  listArchivedChatRooms,
  listChatRooms,
  resetChatRoomStoreForTests,
  softDeleteChatRoom
} from '$lib/server/chatRoomStore';

// LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): archive POST/DELETE now
// require chatRoomAuthGate. Tests supply admin Bearer by default; the
// 401-unauth case has its own dedicated coverage.
const ADMIN_TOKEN_FOR_TESTS = 'archive-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function eventFor(roomId: string, withAuth = true): AnyEvent {
  const headers: Record<string, string> = {};
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    params: { roomId },
    request: new Request(`http://localhost/api/chat-rooms/${roomId}/archive`, { headers })
  } as unknown as AnyEvent;
}

async function runHandler(handler: (event: AnyEvent) => unknown, event: AnyEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('/api/chat-rooms/:roomId/archive', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
  });

  it('archives a room and hides it from the active room list', async () => {
    const room = createChatRoom({ name: 'archive me', whoCreatedIt: '@test' });

    const response = await runHandler(POST, eventFor(room.id));

    expect(response.status).toBe(204);
    expect(listChatRooms().map((r) => r.id)).not.toContain(room.id);
    expect(listArchivedChatRooms().map((r) => r.id)).toContain(room.id);
  });

  it('unarchives an archived room and returns it to the active room list', async () => {
    const room = createChatRoom({ name: 'restore me', whoCreatedIt: '@test' });
    expect((await runHandler(POST, eventFor(room.id))).status).toBe(204);

    const response = await runHandler(DELETE, eventFor(room.id));

    expect(response.status).toBe(204);
    expect(listArchivedChatRooms().map((r) => r.id)).not.toContain(room.id);
    expect(listChatRooms().map((r) => r.id)).toContain(room.id);
  });

  it('returns 404 for missing, already archived, not archived, and soft-deleted rooms', async () => {
    const active = createChatRoom({ name: 'active', whoCreatedIt: '@test' });
    const archived = createChatRoom({ name: 'archived', whoCreatedIt: '@test' });
    const deleted = createChatRoom({ name: 'deleted', whoCreatedIt: '@test' });
    expect((await runHandler(POST, eventFor(archived.id))).status).toBe(204);
    softDeleteChatRoom(deleted.id);

    expect((await runHandler(POST, eventFor('missing'))).status).toBe(404);
    expect((await runHandler(POST, eventFor(archived.id))).status).toBe(404);
    expect((await runHandler(POST, eventFor(deleted.id))).status).toBe(404);
    expect((await runHandler(DELETE, eventFor('missing'))).status).toBe(404);
    expect((await runHandler(DELETE, eventFor(active.id))).status).toBe(404);
    expect((await runHandler(DELETE, eventFor(deleted.id))).status).toBe(404);
  });

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-archive', whoCreatedIt: '@test' });
    const response = await runHandler(POST, eventFor(room.id, false));
    expect(response.status).toBe(401);
    expect(listArchivedChatRooms().map((r) => r.id)).not.toContain(room.id);
  });

  it('DELETE returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-unarchive', whoCreatedIt: '@test' });
    await runHandler(POST, eventFor(room.id));
    const response = await runHandler(DELETE, eventFor(room.id, false));
    expect(response.status).toBe(401);
    expect(listArchivedChatRooms().map((r) => r.id)).toContain(room.id);
  });
});
