/**
 * Endpoint tests for PUT/DELETE /api/chair/:roomId/llm-summary.
 *
 * Covers M29 slice 4b: thin wrapper over the slice 4a seam. PUT validates
 * room existence BEFORE body parse so no mutation occurs on 404. DELETE
 * is intentionally idempotent and room-existence-independent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUT, DELETE } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  listChairDigest,
  resetChairStoreForTests
} from '$lib/server/chairStore';

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'chair-summary-test-admin';

function eventFor(method: 'PUT' | 'DELETE', roomId: string, body?: string, authenticated = true) {
  const url = new URL(`http://localhost/api/chair/${roomId}/llm-summary`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authenticated) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  const request = new Request(url.toString(), {
    method,
    headers,
    body
  });
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

const callPut = (roomId: string, body?: string, authenticated = true) =>
  runHandler(PUT, eventFor('PUT', roomId, body, authenticated));
const callDelete = (roomId: string, body?: string, authenticated = true) =>
  runHandler(DELETE, eventFor('DELETE', roomId, body, authenticated));

describe('/api/chair/:roomId/llm-summary', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetChatRoomStoreForTests();
    resetChairStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  describe('PUT', () => {
    it('returns 401 for anonymous summary writes before mutation', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ summary: 'blocked' }), false);
      expect(response.status).toBe(401);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('returns 200 with roomId on a successful set', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ summary: 'Cheap-model digest' }));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { roomId: string };
      expect(body.roomId).toBe(room.id);
      const digest = listChairDigest();
      expect(digest[0].llmGeneratedSummary).toBe('Cheap-model digest');
    });

    it('returns 400 when summary is missing or not a string', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const missing = await callPut(room.id, JSON.stringify({}));
      expect(missing.status).toBe(400);
      const nonString = await callPut(room.id, JSON.stringify({ summary: 42 }));
      expect(nonString.status).toBe(400);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('returns 400 on blank/whitespace-only summary with no mutation', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ summary: '   ' }));
      expect(response.status).toBe(400);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('returns 404 on unknown roomId with no mutation', async () => {
      createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const response = await callPut('missing-id', JSON.stringify({ summary: 'valid' }));
      expect(response.status).toBe(404);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('returns 400 on malformed JSON body shapes', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const arrayBody = await callPut(room.id, JSON.stringify(['not', 'an', 'object']));
      expect(arrayBody.status).toBe(400);
      const emptyBody = await callPut(room.id, '');
      expect(emptyBody.status).toBe(400);
      const invalidJson = await callPut(room.id, '{not json}');
      expect(invalidJson.status).toBe(400);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('overwrites an existing summary idempotently', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ summary: 'first' }));
      await callPut(room.id, JSON.stringify({ summary: 'second' }));
      const digest = listChairDigest();
      expect(digest[0].llmGeneratedSummary).toBe('second');
    });
  });

  describe('DELETE', () => {
    it('returns 401 for anonymous summary clears before mutation', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ summary: 'to keep' }));
      const response = await callDelete(room.id, undefined, false);
      expect(response.status).toBe(401);
      const digest = listChairDigest();
      expect(digest[0].llmGeneratedSummary).toBe('to keep');
    });

    it('returns 200 with roomId and clears the stored summary', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ summary: 'to clear' }));
      const response = await callDelete(room.id);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { roomId: string };
      expect(body.roomId).toBe(room.id);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('returns 200 even when no summary was stored (idempotent)', async () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const response = await callDelete(room.id);
      expect(response.status).toBe(200);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('returns 200 on unknown roomId (room-existence-independent clear)', async () => {
      createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const response = await callDelete('missing-id');
      expect(response.status).toBe(200);
      const body = (await response.json()) as { roomId: string };
      expect(body.roomId).toBe('missing-id');
    });

    it('clearing roomA does not affect roomB summary (per-room scoping)', async () => {
      const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
      await callPut(roomA.id, JSON.stringify({ summary: 'A summary' }));
      await callPut(roomB.id, JSON.stringify({ summary: 'B summary' }));
      await callDelete(roomA.id);
      const digest = listChairDigest();
      expect(Reflect.has(digest.find((d) => d.roomId === roomA.id)!, 'llmGeneratedSummary')).toBe(false);
      expect(digest.find((d) => d.roomId === roomB.id)?.llmGeneratedSummary).toBe('B summary');
    });
  });
});
