import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATCH } from './+server';
import {
  createChatRoom,
  findChatRoomById,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): members PATCH now requires
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'members-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

function eventFor(roomId: string, handle: string, body: unknown, withAuth = true) {
  const encodedHandle = encodeURIComponent(handle);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(
    `http://localhost/api/chat-rooms/${roomId}/members/${encodedHandle}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body)
    }
  );
  return { request, params: { roomId, handle: encodedHandle } } as unknown as Parameters<
    typeof PATCH
  >[0];
}

async function callPatch(
  roomId: string,
  handle: string,
  body: unknown,
  withAuth = true
): Promise<Response> {
  try {
    return (await PATCH(eventFor(roomId, handle, body, withAuth))) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('/api/chat-rooms/:roomId/members/:handle PATCH', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
  });

  it('updates room-scoped display name, colour, icon, and background without changing the canonical handle', async () => {
    const room = createChatRoom({ name: 'identity', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    const response = await callPatch(room.id, '@evolveantcodex', {
      displayName: 'Codex',
      displayColor: '#059669',
      displayIcon: 'C',
      displayBackgroundStyle: 'tint'
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      member: {
        handle: string;
        displayName: string;
        displayColor: string;
        displayIcon: string;
        displayBackgroundStyle: string;
      };
    };
    expect(body.member).toMatchObject({
      handle: '@evolveantcodex',
      displayName: 'Codex',
      displayColor: '#059669',
      displayIcon: 'C',
      displayBackgroundStyle: 'tint'
    });
    const updated = findChatRoomById(room.id);
    expect(updated?.members.find((member) => member.handle === '@evolveantcodex')).toMatchObject({
      handle: '@evolveantcodex',
      displayName: 'Codex',
      displayColor: '#059669',
      displayIcon: 'C',
      displayBackgroundStyle: 'tint'
    });
  });

  it('normalises a bare handle route param and uppercases hex colours', async () => {
    const room = createChatRoom({ name: 'bare', whoCreatedIt: '@you' });

    const response = await callPatch(room.id, 'you', {
      displayColor: '#7c3aed'
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { member: { displayColor: string } };
    expect(body.member.displayColor).toBe('#7C3AED');
  });

  it('rejects invalid display colours', async () => {
    const room = createChatRoom({ name: 'invalid-colour', whoCreatedIt: '@you' });

    const response = await callPatch(room.id, '@you', {
      displayColor: 'blue'
    });

    expect(response.status).toBe(400);
  });

  it('rejects invalid background styles', async () => {
    const room = createChatRoom({ name: 'invalid-background', whoCreatedIt: '@you' });

    const response = await callPatch(room.id, '@you', {
      displayBackgroundStyle: 'pattern'
    });

    expect(response.status).toBe(400);
  });

  it('returns 404 for a handle that is not a room member', async () => {
    const room = createChatRoom({ name: 'missing-member', whoCreatedIt: '@you' });

    const response = await callPatch(room.id, '@missing', {
      displayName: 'Missing'
    });

    expect(response.status).toBe(404);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-member', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    const response = await callPatch(
      room.id,
      '@evolveantcodex',
      { displayName: 'Hijack' },
      false
    );

    expect(response.status).toBe(401);
    const updated = findChatRoomById(room.id);
    expect(
      updated?.members.find((member) => member.handle === '@evolveantcodex')?.displayName
    ).not.toBe('Hijack');
  });
});
