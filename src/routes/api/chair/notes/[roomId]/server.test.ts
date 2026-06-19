/**
 * Endpoint tests for PUT/DELETE /api/chair/notes/:roomId.
 *
 * Mirrors the fail-closed pattern from M12 breaks and M03 slice 1 aliases:
 * unknown room 404, malformed/non-object body 400, blank noteText 400,
 * idempotent PUT-replace, DELETE reports prior existence.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUT, DELETE } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  findDigestNote,
  setDigestNote,
  resetChairDigestNoteStoreForTests
} from '$lib/server/chairDigestNoteStore';

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'chair-notes-test-admin';

function eventFor(method: 'PUT' | 'DELETE', roomId: string, body?: string, authenticated = true) {
  const url = new URL(`http://localhost/api/chair/notes/${roomId}`);
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
const callDelete = (roomId: string, authenticated = true) =>
  runHandler(DELETE, eventFor('DELETE', roomId, undefined, authenticated));

describe('/api/chair/notes/:roomId', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetChatRoomStoreForTests();
    resetChairDigestNoteStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  describe('PUT', () => {
    it('returns 401 for anonymous note writes before mutation', async () => {
      const room = createChatRoom({ name: 'put-blocked', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ noteText: 'blocked' }), false);
      expect(response.status).toBe(401);
      expect(findDigestNote(room.id)).toBeUndefined();
    });

    it('returns 200 and saves the note', async () => {
      const room = createChatRoom({ name: 'put-happy', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ noteText: 'shipping slice 5 next' }));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { note: { noteText: string } };
      expect(body.note.noteText).toBe('shipping slice 5 next');
      expect(findDigestNote(room.id)?.noteText).toBe('shipping slice 5 next');
    });

    it('replaces the existing note on a second PUT', async () => {
      const room = createChatRoom({ name: 'put-replace', whoCreatedIt: '@you' });
      await callPut(room.id, JSON.stringify({ noteText: 'first' }));
      const second = await callPut(room.id, JSON.stringify({ noteText: 'second' }));
      expect(second.status).toBe(200);
      expect(findDigestNote(room.id)?.noteText).toBe('second');
    });

    it('returns 404 when the room is unknown', async () => {
      const response = await callPut('doesnotexist', JSON.stringify({ noteText: 'whatever' }));
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

    it('returns 400 when the body parses to a non-object', async () => {
      const room = createChatRoom({ name: 'array-body', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify(['noteText']));
      expect(response.status).toBe(400);
    });

    it('returns 400 when noteText is missing', async () => {
      const room = createChatRoom({ name: 'missing-note', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({}));
      expect(response.status).toBe(400);
    });

    it('returns 400 when noteText is blank after trim', async () => {
      const room = createChatRoom({ name: 'blank-note', whoCreatedIt: '@you' });
      const response = await callPut(room.id, JSON.stringify({ noteText: '   ' }));
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('returns 401 for anonymous note clears before mutation', async () => {
      const room = createChatRoom({ name: 'delete-blocked', whoCreatedIt: '@you' });
      setDigestNote({ roomId: room.id, noteText: 'keep' });
      const response = await callDelete(room.id, false);
      expect(response.status).toBe(401);
      expect(findDigestNote(room.id)?.noteText).toBe('keep');
    });

    it('returns 200 wasCleared=true when a note existed', async () => {
      const room = createChatRoom({ name: 'delete-existing', whoCreatedIt: '@you' });
      setDigestNote({ roomId: room.id, noteText: 'going away' });

      const response = await callDelete(room.id);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { wasCleared: boolean };
      expect(body.wasCleared).toBe(true);
      expect(findDigestNote(room.id)).toBeUndefined();
    });

    it('returns 200 wasCleared=false when nothing was set', async () => {
      const room = createChatRoom({ name: 'delete-empty', whoCreatedIt: '@you' });
      const response = await callDelete(room.id);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { wasCleared: boolean };
      expect(body.wasCleared).toBe(false);
    });

    it('returns 404 when the room is unknown', async () => {
      const response = await callDelete('doesnotexist');
      expect(response.status).toBe(404);
    });
  });
});
