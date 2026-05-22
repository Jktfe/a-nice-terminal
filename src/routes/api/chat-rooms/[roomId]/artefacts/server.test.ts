import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

// LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): POST/DELETE now require
// chatRoomAuthGate. Default tests supply admin Bearer; 401-unauth tests use
// withAuth:false.
const ADMIN_TOKEN_FOR_TESTS = 'artefacts-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(
  method: 'GET' | 'POST' | 'DELETE',
  roomId: string,
  search = '',
  body?: unknown,
  withAuth = true
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/artefacts${search}`);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = new Request(url.toString(), init);
  return { request, params: { roomId }, url } as unknown as AnyEvent;
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

describe('/api/chat-rooms/:roomId/artefacts', () => {
  beforeEach(() => {
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('GET 404s when the room does not exist', async () => {
    const response = await runHandler(GET, eventFor('GET', 'ghost'));
    expect(response.status).toBe(404);
  });

  it('GET returns an empty list for a fresh room', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await runHandler(GET, eventFor('GET', room.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ artefacts: [] });
  });

  it('POST creates an artefact and GET reflects it', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const create = await runHandler(
      POST,
      eventFor('POST', room.id, '', {
        kind: 'deck',
        title: 'Pitch v1',
        refUrl: 'https://example.com/deck'
      })
    );
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created).toMatchObject({ kind: 'deck', title: 'Pitch v1', refUrl: 'https://example.com/deck' });

    const list = await runHandler(GET, eventFor('GET', room.id));
    const listBody = await list.json();
    expect(listBody.artefacts).toHaveLength(1);
    expect(listBody.artefacts[0].id).toBe(created.id);
  });

  it('POST 400s for an unknown kind', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await runHandler(
      POST,
      eventFor('POST', room.id, '', { kind: 'mystery', title: 'thing' })
    );
    expect(response.status).toBe(400);
  });

  it('POST 400s when title is blank', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await runHandler(
      POST,
      eventFor('POST', room.id, '', { kind: 'doc', title: '   ' })
    );
    expect(response.status).toBe(400);
  });

  it('DELETE soft-deletes by artefactId and 404s on second attempt', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const create = await runHandler(
      POST,
      eventFor('POST', room.id, '', { kind: 'mockup', title: 'wireframe' })
    );
    const created = await create.json();
    const remove = await runHandler(
      DELETE,
      eventFor('DELETE', room.id, `?artefactId=${created.id}`)
    );
    expect(remove.status).toBe(204);
    const removeAgain = await runHandler(
      DELETE,
      eventFor('DELETE', room.id, `?artefactId=${created.id}`)
    );
    expect(removeAgain.status).toBe(404);
  });

  it('DELETE accepts pidChain from CLI body so agents can remove their artefacts', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({
      pid: 77_001,
      pid_start: 'artefact-remove-test',
      name: 'artefact-remove-agent',
      ttlSeconds: 60 * 60
    });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: terminal.id });
    const create = await runHandler(
      POST,
      eventFor('POST', room.id, '', { kind: 'doc', title: 'wrong pointer' })
    );
    const created = await create.json();

    const remove = await runHandler(
      DELETE,
      eventFor(
        'DELETE',
        room.id,
        `?artefactId=${created.id}`,
        { pidChain: [{ pid: 77_001, pid_start: 'artefact-remove-test' }] },
        false
      )
    );

    expect(remove.status).toBe(204);
  });

  it('DELETE 400s when artefactId is missing', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await runHandler(DELETE, eventFor('DELETE', room.id));
    expect(response.status).toBe(400);
  });

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await runHandler(
      POST,
      eventFor('POST', room.id, '', { kind: 'doc', title: 'hijacked' }, false)
    );
    expect(response.status).toBe(401);
  });

  it('DELETE returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const create = await runHandler(
      POST,
      eventFor('POST', room.id, '', { kind: 'doc', title: 'art' })
    );
    const created = await create.json();
    const remove = await runHandler(
      DELETE,
      eventFor('DELETE', room.id, `?artefactId=${created.id}`, undefined, false)
    );
    expect(remove.status).toBe(401);
  });
});
