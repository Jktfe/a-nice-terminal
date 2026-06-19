/**
 * Endpoint tests for GET/PUT/DELETE /api/chat-rooms/:roomId/focus-mode.
 *
 * Covers the focus-mode contract: unknown room before blank-handle check,
 * member-must-be-in-room 404, fail-closed body parsing, idempotent
 * replace, optional reason, reason cap, per-member isolation, exitFocus
 * boolean.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, PUT, DELETE } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  findFocus,
  resetFocusModeStoreForTests,
  FOCUS_REASON_MAX_LENGTH
} from '$lib/server/focusModeStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): focus-mode PUT/DELETE now require
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'focus-mode-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

function eventFor(
  method: 'GET' | 'PUT' | 'DELETE',
  roomId: string,
  body?: string,
  withAuth = true
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/focus-mode`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(url.toString(), { method, headers, body });
  return { request, params: { roomId }, url } as unknown as Parameters<typeof PUT>[0];
}

async function runHandler(
  handler: (event: Parameters<typeof PUT>[0]) => unknown,
  event: Parameters<typeof PUT>[0]
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

const callGet = (roomId: string) => runHandler(GET, eventFor('GET', roomId));
const callPut = (roomId: string, body?: string, withAuth = true) =>
  runHandler(PUT, eventFor('PUT', roomId, body, withAuth));
const callDelete = (roomId: string, body?: string, withAuth = true) =>
  runHandler(DELETE, eventFor('DELETE', roomId, body, withAuth));

describe('/api/chat-rooms/:roomId/focus-mode', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetFocusModeStoreForTests();
  });

  describe('GET', () => {
    it('returns 200 with empty list when nobody is focused', async () => {
      const room = createChatRoom({ name: 'no-focus', whoCreatedIt: '@you' });
      const response = await callGet(room.id);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { focusedMembers: unknown[] };
      expect(body.focusedMembers).toEqual([]);
    });

    it('returns 200 with the focused list when entries exist', async () => {
      const room = createChatRoom({ name: 'has-focus', whoCreatedIt: '@you' });
      await callPut(
        room.id,
        JSON.stringify({ memberHandle: '@you', reason: 'deep review' })
      );
      const response = await callGet(room.id);
      const body = (await response.json()) as {
        focusedMembers: { memberHandle: string; reason?: string }[];
      };
      expect(body.focusedMembers).toHaveLength(1);
      expect(body.focusedMembers[0].memberHandle).toBe('@you');
      expect(body.focusedMembers[0].reason).toBe('deep review');
    });

    it('returns 404 when the room is unknown', async () => {
      const response = await callGet('doesnotexist');
      expect(response.status).toBe(404);
    });
  });

  describe('PUT', () => {
    it('returns 200 and saves the focus entry with a reason', async () => {
      const room = createChatRoom({ name: 'put-happy', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ memberHandle: '@you', reason: 'writing PR' })
      );
      expect(response.status).toBe(200);
      expect(findFocus(room.id, '@you')?.reason).toBe('writing PR');
    });

    it('returns 200 and saves the focus entry with no reason', async () => {
      const room = createChatRoom({ name: 'put-no-reason', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ memberHandle: '@you' }));
      expect(response.status).toBe(200);
      expect(findFocus(room.id, '@you')?.reason).toBeUndefined();
    });

    it('replaces an existing focus entry on second PUT (idempotent)', async () => {
      const room = createChatRoom({ name: 'put-replace', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ memberHandle: '@you', reason: 'first' }));
      const second = await callPut(
        room.id,
        JSON.stringify({ memberHandle: '@you', reason: 'second' })
      );
      expect(second.status).toBe(200);
      expect(findFocus(room.id, '@you')?.reason).toBe('second');
    });

    it('accepts mode=solo and ignores body-supplied setter', async () => {
      const room = createChatRoom({ name: 'put-mode-setter', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        // a spoofed `setter` in the body must be IGNORED — the gate decides.
        JSON.stringify({ memberHandle: '@you', mode: 'solo', setter: '@someone-else' })
      );
      expect(response.status).toBe(200);
      const entry = findFocus(room.id, '@you');
      expect(entry?.mode).toBe('solo');
      expect(entry?.setter).toBe('@you'); // admin-bearer focus is self-set so timer prompts are deliverable
    });

    it('defaults mode to shield when omitted', async () => {
      const room = createChatRoom({ name: 'put-default-mode', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ memberHandle: '@you' }));
      expect(findFocus(room.id, '@you')?.mode).toBe('shield');
    });

    it('accepts directMentionsOnly for shield breakthrough routing', async () => {
      const room = createChatRoom({ name: 'put-direct-only', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ memberHandle: '@you', mode: 'shield', directMentionsOnly: true })
      );
      expect(response.status).toBe(200);
      expect(findFocus(room.id, '@you')?.directMentionsOnly).toBe(true);
    });

    it('returns 400 on an invalid mode', async () => {
      const room = createChatRoom({ name: 'put-bad-mode', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ memberHandle: '@you', mode: 'lurk' }));
      expect(response.status).toBe(400);
    });

    it('returns 404 when the room is unknown', async () => {
      const response = await callPut(
        'doesnotexist',
        JSON.stringify({ memberHandle: '@you', reason: 'x' })
      );
      expect(response.status).toBe(404);
    });

    it('returns 404 when the handle is not a member of the room', async () => {
      const room = createChatRoom({ name: 'nonmember', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ memberHandle: '@stranger', reason: 'x' })
      );
      expect(response.status).toBe(404);
    });

    it('returns 400 when the body is empty', async () => {
      const room = createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
      const response = await callPut(room.id, '');
      expect(response.status).toBe(400);
    });

    it('returns 400 when the body is malformed JSON', async () => {
      const room = createChatRoom({ name: 'malformed', whoCreatedIt: '@you' });
      const response = await callPut(room.id, '{ not valid');
      expect(response.status).toBe(400);
    });

    it('returns 400 when the body parses to a non-object (array)', async () => {
      const room = createChatRoom({ name: 'array-body', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify(['memberHandle']));
      expect(response.status).toBe(400);
    });

    it('returns 400 when memberHandle is missing', async () => {
      const room = createChatRoom({ name: 'no-handle', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ reason: 'x' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when memberHandle is blank after trim', async () => {
      const room = createChatRoom({ name: 'blank-handle', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ memberHandle: '   ', reason: 'x' })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when reason is longer than the cap', async () => {
      const room = createChatRoom({ name: 'long-reason', whoCreatedIt: '@you' });
      const tooLong = 'x'.repeat(FOCUS_REASON_MAX_LENGTH + 1);
      const response = await callPut(
        room.id,
        JSON.stringify({ memberHandle: '@you', reason: tooLong })
      );
      expect(response.status).toBe(400);
      expect(findFocus(room.id, '@you')).toBeUndefined();
    });

    it('returns 400 when reason is not a string (when present)', async () => {
      const room = createChatRoom({ name: 'non-string-reason', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ memberHandle: '@you', reason: 42 })
      );
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('returns 200 wasActive=true when a focus existed', async () => {
      const room = createChatRoom({ name: 'delete-existing', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ memberHandle: '@you', reason: 'going' }));
      const response = await callDelete(
        room.id,
        JSON.stringify({ memberHandle: '@you' })
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { wasActive: boolean };
      expect(body.wasActive).toBe(true);
      expect(findFocus(room.id, '@you')).toBeUndefined();
    });

    it('returns 200 wasActive=false when nothing was set', async () => {
      const room = createChatRoom({ name: 'delete-empty', whoCreatedIt: '@you' });
      const response = await callDelete(
        room.id,
        JSON.stringify({ memberHandle: '@you' })
      );
      const body = (await response.json()) as { wasActive: boolean };
      expect(body.wasActive).toBe(false);
    });

    it('returns 404 when the room is unknown', async () => {
      const response = await callDelete(
        'doesnotexist',
        JSON.stringify({ memberHandle: '@you' })
      );
      expect(response.status).toBe(404);
    });

    it('returns 400 when memberHandle is missing or blank', async () => {
      const room = createChatRoom({ name: 'delete-missing', whoCreatedIt: '@you' });
      const blank = await callDelete(
        room.id,
        JSON.stringify({ memberHandle: '   ' })
      );
      expect(blank.status).toBe(400);
      const missing = await callDelete(room.id, JSON.stringify({}));
      expect(missing.status).toBe(400);
    });
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  describe('auth gate', () => {
    it('PUT returns 401 when no auth header is provided', async () => {
      const room = createChatRoom({ name: 'unauth-focus-put', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ memberHandle: '@you', reason: 'nope' }),
        false
      );
      expect(response.status).toBe(401);
      expect(findFocus(room.id, '@you')).toBeUndefined();
    });

    it('DELETE returns 401 when no auth header is provided', async () => {
      const room = createChatRoom({ name: 'unauth-focus-del', whoCreatedIt: '@you' });
      const response = await callDelete(
        room.id,
        JSON.stringify({ memberHandle: '@you' }),
        false
      );
      expect(response.status).toBe(401);
    });
  });
});
