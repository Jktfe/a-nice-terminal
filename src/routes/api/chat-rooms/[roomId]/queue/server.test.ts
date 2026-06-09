/**
 * Endpoint tests for the curated message queue routes:
 *   GET/POST   /api/chat-rooms/:roomId/queue
 *   PATCH/DELETE /api/chat-rooms/:roomId/queue/:queueId
 *   POST       /api/chat-rooms/:roomId/queue/pull
 *
 * MODEL-FREE: pure SQLite store + the shared chatRoomAuthGate. Mirrors the
 * focus-mode route test for RequestEvent construction + admin-bearer auth.
 * Covers: enqueue→list, pull (one-in-flight), patch edit/reorder, delete/drop,
 * and an auth-rejection case.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { PATCH, DELETE } from './[queueId]/+server';
import { POST as PULL } from './pull/+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetMessageQueueForTests, type QueueItem } from '$lib/server/messageQueueStore';

const ADMIN_TOKEN_FOR_TESTS = 'queue-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: string,
  path: string,
  opts: { body?: string; queueId?: string; roomId: string; withAuth?: boolean } = {
    roomId: 'x'
  }
) {
  const withAuth = opts.withAuth ?? true;
  const url = new URL(`http://localhost${path}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(url.toString(), { method, headers, body: opts.body });
  const params: Record<string, string> = { roomId: opts.roomId };
  if (opts.queueId !== undefined) params.queueId = opts.queueId;
  return { request, params, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
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

const CHAIR = '@localchair';

const callGet = (roomId: string, query = `?handle=${encodeURIComponent(CHAIR)}`) =>
  runHandler(GET as AnyHandler, eventFor('GET', `/api/chat-rooms/${roomId}/queue${query}`, { roomId }));

const callPost = (roomId: string, body?: string, withAuth = true) =>
  runHandler(
    POST as AnyHandler,
    eventFor('POST', `/api/chat-rooms/${roomId}/queue`, { roomId, body, withAuth })
  );

const callPatch = (roomId: string, queueId: string, body?: string, withAuth = true) =>
  runHandler(
    PATCH as AnyHandler,
    eventFor('PATCH', `/api/chat-rooms/${roomId}/queue/${queueId}`, {
      roomId,
      queueId,
      body,
      withAuth
    })
  );

const callDelete = (roomId: string, queueId: string, withAuth = true) =>
  runHandler(
    DELETE as AnyHandler,
    eventFor('DELETE', `/api/chat-rooms/${roomId}/queue/${queueId}`, {
      roomId,
      queueId,
      withAuth
    })
  );

const callPull = (roomId: string, body?: string, withAuth = true) =>
  runHandler(
    PULL as AnyHandler,
    eventFor('POST', `/api/chat-rooms/${roomId}/queue/pull`, { roomId, body, withAuth })
  );

async function enqueueItem(roomId: string, text: string, extra: Record<string, unknown> = {}) {
  const response = await callPost(roomId, JSON.stringify({ targetHandle: CHAIR, text, ...extra }));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { item: QueueItem };
  return body.item;
}

describe('/api/chat-rooms/:roomId/queue', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetMessageQueueForTests();
  });

  describe('enqueue → list', () => {
    it('enqueues an item and lists it back', async () => {
      const room = createChatRoom({ name: 'enqueue-list', whoCreatedIt: '@you' });
      const item = await enqueueItem(room.id, 'first thing');
      expect(item.curatedText).toBe('first thing');
      expect(item.targetHandle).toBe(CHAIR);
      expect(item.status).toBe('pending');

      const listResponse = await callGet(room.id);
      expect(listResponse.status).toBe(200);
      const listBody = (await listResponse.json()) as { items: QueueItem[] };
      expect(listBody.items).toHaveLength(1);
      expect(listBody.items[0].id).toBe(item.id);
    });

    it('filters list by status', async () => {
      const room = createChatRoom({ name: 'list-filter', whoCreatedIt: '@you' });
      await enqueueItem(room.id, 'pending one');
      const pending = await callGet(room.id, `?handle=${encodeURIComponent(CHAIR)}&status=pending`);
      const pendingBody = (await pending.json()) as { items: QueueItem[] };
      expect(pendingBody.items).toHaveLength(1);

      const done = await callGet(room.id, `?handle=${encodeURIComponent(CHAIR)}&status=done`);
      const doneBody = (await done.json()) as { items: QueueItem[] };
      expect(doneBody.items).toHaveLength(0);
    });

    it('returns 404 when the room is unknown', async () => {
      const response = await callGet('doesnotexist');
      expect(response.status).toBe(404);
    });

    it('GET returns 400 when handle is missing', async () => {
      const room = createChatRoom({ name: 'no-handle-get', whoCreatedIt: '@you' });
      const response = await callGet(room.id, '');
      expect(response.status).toBe(400);
    });

    it('POST returns 400 when text is blank', async () => {
      const room = createChatRoom({ name: 'blank-text', whoCreatedIt: '@you' });
      const response = await callPost(room.id, JSON.stringify({ targetHandle: CHAIR, text: '   ' }));
      expect(response.status).toBe(400);
    });

    it('POST returns 400 when targetHandle is missing', async () => {
      const room = createChatRoom({ name: 'no-target', whoCreatedIt: '@you' });
      const response = await callPost(room.id, JSON.stringify({ text: 'orphan' }));
      expect(response.status).toBe(400);
    });

    it('POST returns 400 on a bad kind', async () => {
      const room = createChatRoom({ name: 'bad-kind', whoCreatedIt: '@you' });
      const response = await callPost(
        room.id,
        JSON.stringify({ targetHandle: CHAIR, text: 'x', kind: 'nope' })
      );
      expect(response.status).toBe(400);
    });

    it('POST returns 400 on empty body', async () => {
      const room = createChatRoom({ name: 'empty-body', whoCreatedIt: '@you' });
      const response = await callPost(room.id, '');
      expect(response.status).toBe(400);
    });
  });

  describe('pull (one-in-flight)', () => {
    it('pulls the next pending item and flips it to working', async () => {
      const room = createChatRoom({ name: 'pull-one', whoCreatedIt: '@you' });
      const a = await enqueueItem(room.id, 'A', { priority: 1 });
      await enqueueItem(room.id, 'B', { priority: 2 });

      const pulled = await callPull(room.id, JSON.stringify({ targetHandle: CHAIR }));
      expect(pulled.status).toBe(200);
      const pulledBody = (await pulled.json()) as { item: QueueItem | null };
      expect(pulledBody.item?.id).toBe(a.id);
      expect(pulledBody.item?.status).toBe('working');
    });

    it('returns item:null when one is already in-flight (one-in-flight)', async () => {
      const room = createChatRoom({ name: 'pull-busy', whoCreatedIt: '@you' });
      await enqueueItem(room.id, 'A');
      await enqueueItem(room.id, 'B');

      const first = await callPull(room.id, JSON.stringify({ targetHandle: CHAIR }));
      expect(((await first.json()) as { item: QueueItem | null }).item).not.toBeNull();

      const second = await callPull(room.id, JSON.stringify({ targetHandle: CHAIR }));
      const secondBody = (await second.json()) as { item: QueueItem | null };
      expect(secondBody.item).toBeNull();
    });

    it('returns item:null when nothing is pending', async () => {
      const room = createChatRoom({ name: 'pull-empty', whoCreatedIt: '@you' });
      const response = await callPull(room.id, JSON.stringify({ targetHandle: CHAIR }));
      const body = (await response.json()) as { item: QueueItem | null };
      expect(body.item).toBeNull();
    });

    it('returns 400 when targetHandle is missing', async () => {
      const room = createChatRoom({ name: 'pull-no-target', whoCreatedIt: '@you' });
      const response = await callPull(room.id, JSON.stringify({}));
      expect(response.status).toBe(400);
    });
  });

  describe('patch (edit / reorder)', () => {
    it('edits curatedText', async () => {
      const room = createChatRoom({ name: 'patch-edit', whoCreatedIt: '@you' });
      const item = await enqueueItem(room.id, 'raw text');
      const response = await callPatch(
        room.id,
        item.id,
        JSON.stringify({ curatedText: 'condensed' })
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { item: QueueItem };
      expect(body.item.curatedText).toBe('condensed');
    });

    it('reorders via priority and the list reflects the new order', async () => {
      const room = createChatRoom({ name: 'patch-reorder', whoCreatedIt: '@you' });
      const a = await enqueueItem(room.id, 'A', { priority: 1 });
      const b = await enqueueItem(room.id, 'B', { priority: 2 });

      // Bump B ahead of A.
      const response = await callPatch(room.id, b.id, JSON.stringify({ priority: 0 }));
      expect(response.status).toBe(200);

      const listBody = (await (await callGet(room.id)).json()) as { items: QueueItem[] };
      expect(listBody.items.map((i) => i.id)).toEqual([b.id, a.id]);
    });

    it('returns 404 for an unknown item', async () => {
      const room = createChatRoom({ name: 'patch-404', whoCreatedIt: '@you' });
      const response = await callPatch(room.id, 'q_nope', JSON.stringify({ curatedText: 'x' }));
      expect(response.status).toBe(404);
    });

    it('returns 400 when no patch fields are present', async () => {
      const room = createChatRoom({ name: 'patch-empty', whoCreatedIt: '@you' });
      const item = await enqueueItem(room.id, 'x');
      const response = await callPatch(room.id, item.id, JSON.stringify({}));
      expect(response.status).toBe(400);
    });
  });

  describe('delete (drop)', () => {
    it('drops an item so it leaves the pending list', async () => {
      const room = createChatRoom({ name: 'delete-drop', whoCreatedIt: '@you' });
      const item = await enqueueItem(room.id, 'to drop');
      const response = await callDelete(room.id, item.id);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { wasActive: boolean };
      expect(body.wasActive).toBe(true);

      const pending = await callGet(room.id, `?handle=${encodeURIComponent(CHAIR)}&status=pending`);
      const pendingBody = (await pending.json()) as { items: QueueItem[] };
      expect(pendingBody.items).toHaveLength(0);
    });

    it('returns 404 for an unknown item', async () => {
      const room = createChatRoom({ name: 'delete-404', whoCreatedIt: '@you' });
      const response = await callDelete(room.id, 'q_nope');
      expect(response.status).toBe(404);
    });
  });

  describe('auth gate', () => {
    it('POST returns 401 with no auth header', async () => {
      const room = createChatRoom({ name: 'unauth-post', whoCreatedIt: '@you' });
      const response = await callPost(
        room.id,
        JSON.stringify({ targetHandle: CHAIR, text: 'nope' }),
        false
      );
      expect(response.status).toBe(401);

      const listBody = (await (await callGet(room.id)).json()) as { items: QueueItem[] };
      expect(listBody.items).toHaveLength(0);
    });

    it('PATCH returns 401 with no auth header', async () => {
      const room = createChatRoom({ name: 'unauth-patch', whoCreatedIt: '@you' });
      const item = await enqueueItem(room.id, 'x');
      const response = await callPatch(
        room.id,
        item.id,
        JSON.stringify({ curatedText: 'y' }),
        false
      );
      expect(response.status).toBe(401);
    });

    it('DELETE returns 401 with no auth header', async () => {
      const room = createChatRoom({ name: 'unauth-delete', whoCreatedIt: '@you' });
      const item = await enqueueItem(room.id, 'x');
      const response = await callDelete(room.id, item.id, false);
      expect(response.status).toBe(401);
    });

    it('PULL returns 401 with no auth header', async () => {
      const room = createChatRoom({ name: 'unauth-pull', whoCreatedIt: '@you' });
      await enqueueItem(room.id, 'x');
      const response = await callPull(room.id, JSON.stringify({ targetHandle: CHAIR }), false);
      expect(response.status).toBe(401);
    });
  });
});
