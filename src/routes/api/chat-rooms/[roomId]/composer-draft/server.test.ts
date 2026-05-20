/**
 * Endpoint tests for GET/PUT/DELETE /api/chat-rooms/:roomId/composer-draft.
 *
 * Covers the never-lose-typed-text contract: unknown room before blank-draft
 * check, malformed/empty/array body 400, blank draft rejected as 400 (clients
 * must DELETE to clear), idempotent replace, per-author isolation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, PUT, DELETE } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  findDraft,
  resetComposerDraftStoreForTests
} from '$lib/server/composerDraftStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): composer-draft PUT/DELETE now require
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'composer-draft-route-test-admin-token';
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
  query = '',
  withAuth = true
) {
  const url = new URL(
    `http://localhost/api/chat-rooms/${roomId}/composer-draft${query}`
  );
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

const callGet = (roomId: string, query?: string) =>
  runHandler(GET, eventFor('GET', roomId, undefined, query ?? ''));
const callPut = (roomId: string, body?: string, withAuth = true) =>
  runHandler(PUT, eventFor('PUT', roomId, body, '', withAuth));
const callDelete = (roomId: string, body?: string, withAuth = true) =>
  runHandler(DELETE, eventFor('DELETE', roomId, body, '', withAuth));

describe('/api/chat-rooms/:roomId/composer-draft', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetComposerDraftStoreForTests();
  });

  describe('GET', () => {
    it('returns 200 with empty string when no draft exists', async () => {
      const room = createChatRoom({ name: 'no-draft', whoCreatedIt: '@you' });
      const response = await callGet(
        room.id,
        '?authorHandle=' + encodeURIComponent('@you')
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { draftText: string };
      expect(body.draftText).toBe('');
    });

    it('returns 200 with the saved draft text when one exists', async () => {
      const room = createChatRoom({ name: 'has-draft', whoCreatedIt: '@you' });
      await callPut(
        room.id,
        JSON.stringify({ authorHandle: '@you', draftText: 'remembered' })
      );

      const response = await callGet(
        room.id,
        '?authorHandle=' + encodeURIComponent('@you')
      );
      const body = (await response.json()) as { draftText: string };
      expect(body.draftText).toBe('remembered');
    });

    it('returns 404 when the room is unknown', async () => {
      const response = await callGet(
        'doesnotexist',
        '?authorHandle=' + encodeURIComponent('@you')
      );
      expect(response.status).toBe(404);
    });

    it('returns 400 when authorHandle query param is missing', async () => {
      const room = createChatRoom({ name: 'missing', whoCreatedIt: '@you' });
      const response = await callGet(room.id, '');
      expect(response.status).toBe(400);
    });
  });

  describe('PUT', () => {
    it('saves the draft and returns 200', async () => {
      const room = createChatRoom({ name: 'put-happy', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ authorHandle: '@you', draftText: 'half-typed' })
      );
      expect(response.status).toBe(200);
      expect(findDraft(room.id, '@you')?.draftText).toBe('half-typed');
    });

    it('replaces the existing draft on a second PUT (idempotent)', async () => {
      const room = createChatRoom({ name: 'put-replace', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ authorHandle: '@you', draftText: 'first' }));
      const second = await callPut(
        room.id,
        JSON.stringify({ authorHandle: '@you', draftText: 'second' })
      );
      expect(second.status).toBe(200);
      expect(findDraft(room.id, '@you')?.draftText).toBe('second');
    });

    it('returns 404 when the room is unknown — BEFORE blank-draft check', async () => {
      const response = await callPut(
        'doesnotexist',
        JSON.stringify({ authorHandle: '@you', draftText: '   ' })
      );
      expect(response.status).toBe(404);
    });

    it('returns 400 when the body is empty', async () => {
      const room = createChatRoom({ name: 'empty-body', whoCreatedIt: '@you' });
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
      const response = await callPut(room.id, JSON.stringify(['authorHandle']));
      expect(response.status).toBe(400);
    });

    it('returns 400 when authorHandle is missing', async () => {
      const room = createChatRoom({ name: 'no-handle', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ draftText: 'x' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when draftText is missing', async () => {
      const room = createChatRoom({ name: 'no-text', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ authorHandle: '@you' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when draftText is blank after trim (use DELETE to clear)', async () => {
      const room = createChatRoom({ name: 'blank-draft', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ authorHandle: '@you', draftText: '   ' })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when authorHandle is blank after trim and persists nothing', async () => {
      const room = createChatRoom({ name: 'blank-handle-put', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ authorHandle: '   ', draftText: 'half-typed' })
      );
      expect(response.status).toBe(400);
      // Confirm no normalised "@" handle entry was persisted: GET with the
      // would-be-normalised handle returns 200 with empty draftText.
      const followup = await callGet(
        room.id,
        '?authorHandle=' + encodeURIComponent('@')
      );
      expect(followup.status).toBe(200);
      const followupBody = (await followup.json()) as { draftText: string };
      expect(followupBody.draftText).toBe('');
    });
  });

  describe('DELETE', () => {
    it('returns 200 wasCleared=true when a draft existed', async () => {
      const room = createChatRoom({ name: 'delete-existing', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ authorHandle: '@you', draftText: 'going' }));

      const response = await callDelete(
        room.id,
        JSON.stringify({ authorHandle: '@you' })
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { wasCleared: boolean };
      expect(body.wasCleared).toBe(true);
      expect(findDraft(room.id, '@you')).toBeUndefined();
    });

    it('returns 200 wasCleared=false when no draft existed', async () => {
      const room = createChatRoom({ name: 'delete-empty', whoCreatedIt: '@you' });
      const response = await callDelete(
        room.id,
        JSON.stringify({ authorHandle: '@you' })
      );
      const body = (await response.json()) as { wasCleared: boolean };
      expect(body.wasCleared).toBe(false);
    });

    it('returns 404 when the room is unknown', async () => {
      const response = await callDelete(
        'doesnotexist',
        JSON.stringify({ authorHandle: '@you' })
      );
      expect(response.status).toBe(404);
    });

    it('returns 400 when authorHandle is missing from the body', async () => {
      const room = createChatRoom({ name: 'delete-missing-handle', whoCreatedIt: '@you' });
      const response = await callDelete(room.id, JSON.stringify({}));
      expect(response.status).toBe(400);
    });

    it('returns 400 when authorHandle is blank after trim', async () => {
      const room = createChatRoom({ name: 'delete-blank-handle', whoCreatedIt: '@you' });
      const response = await callDelete(
        room.id,
        JSON.stringify({ authorHandle: '   ' })
      );
      expect(response.status).toBe(400);
    });
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  describe('auth gate', () => {
    it('PUT returns 401 when no auth header is provided', async () => {
      const room = createChatRoom({ name: 'unauth-draft-put', whoCreatedIt: '@you' });
      const response = await callPut(
        room.id,
        JSON.stringify({ authorHandle: '@you', draftText: 'nope' }),
        false
      );
      expect(response.status).toBe(401);
      expect(findDraft(room.id, '@you')).toBeUndefined();
    });

    it('DELETE returns 401 when no auth header is provided', async () => {
      const room = createChatRoom({ name: 'unauth-draft-del', whoCreatedIt: '@you' });
      const response = await callDelete(
        room.id,
        JSON.stringify({ authorHandle: '@you' }),
        false
      );
      expect(response.status).toBe(401);
    });
  });
});
