/**
 * Endpoint tests for GET/DELETE /api/chat-rooms/:roomId.
 *
 * DELETE is soft-delete: chat_rooms.deleted_at_ms gets stamped, so the room
 * stops listing but files + index rows survive (JWPK SURFACE-SIZE-ONLY).
 * Returns 204 on first delete, 404 on unknown id, and 404 on second delete
 * (softDeleteChatRoom returns false once already-soft-deleted).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET } from './+server';
import {
  createChatRoom,
  findChatRoomById,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';

// LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): DELETE now requires
// chatRoomAuthGate. Tests supply admin Bearer by default; 401-unauth has
// its own dedicated case.
const ADMIN_TOKEN_FOR_TESTS = 'roomid-delete-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

function eventFor(method: 'GET' | 'DELETE', roomId: string, withAuth = true) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}`);
  const headers: Record<string, string> = {};
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(url.toString(), { method, headers });
  return { request, params: { roomId }, url } as unknown as Parameters<typeof GET>[0];
}

async function runHandler(
  handler: (event: Parameters<typeof GET>[0]) => unknown,
  event: Parameters<typeof GET>[0]
): Promise<Response> {
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

const callDelete = (roomId: string) => runHandler(DELETE, eventFor('DELETE', roomId));

describe('/api/chat-rooms/:roomId DELETE', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
  });

  it('returns 204 and soft-deletes an existing room', async () => {
    const room = createChatRoom({ name: 'doomed', whoCreatedIt: '@you' });
    const response = await callDelete(room.id);
    expect(response.status).toBe(204);
    expect(findChatRoomById(room.id)).toBeUndefined();
  });

  it('returns 404 for an unknown room id', async () => {
    const response = await callDelete('does-not-exist');
    expect(response.status).toBe(404);
  });

  it('returns 404 when called twice on the same room (idempotent failure)', async () => {
    const room = createChatRoom({ name: 'double-delete', whoCreatedIt: '@you' });
    const first = await callDelete(room.id);
    expect(first.status).toBe(204);
    const second = await callDelete(room.id);
    expect(second.status).toBe(404);
  });

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  it('returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'no-auth-delete', whoCreatedIt: '@you' });
    const response = await runHandler(DELETE, eventFor('DELETE', room.id, false));
    expect(response.status).toBe(401);
    expect(findChatRoomById(room.id)?.name).toBe('no-auth-delete');
  });
});
