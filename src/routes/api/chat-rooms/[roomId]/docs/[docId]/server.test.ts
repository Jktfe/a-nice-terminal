import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, PUT } from './+server';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { getArtefactContentById } from '$lib/server/chatRoomArtefactContentStore';
import { createArtefactInRoom, resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import { resetChatRoomArtefactContentStoreForTests, upsertArtefactContent } from '$lib/server/chatRoomArtefactContentStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(roomId: string, docId: string): AnyEvent {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/docs/${docId}`);
  return {
    request: new Request(url.toString()),
    params: { roomId, docId },
    url
  } as unknown as AnyEvent;
}

async function runGet(event: AnyEvent): Promise<Response> {
  try {
    return (await GET(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('GET /api/chat-rooms/:roomId/docs/:docId', () => {
  beforeEach(() => {
    resetChatRoomArtefactContentStoreForTests();
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('renders univer-json document content instead of returning the old 501 placeholder', async () => {
    const room = createChatRoom({ name: 'doc room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Shared Univer Notes',
      refUrl: `/api/chat-rooms/${room.id}/docs/univer-doc`,
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'univer-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'univer-json',
      contentBody: JSON.stringify({
        body: {
          dataStream: 'Shared deck decisions\nStage owns live feedback\n'
        }
      }),
      updatedByHandle: '@speedycodex'
    });

    const response = await runGet(eventFor(room.id, 'univer-doc'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Univer JSON Document');
    expect(html).toContain('Shared deck decisions');
    expect(html).toContain('Stage owns live feedback');
    expect(html).not.toContain('not yet implemented');
  });
});

const ADMIN_TOKEN = 'docs-put-test-admin-token';
const ORIG_ADMIN = process.env.ANT_ADMIN_TOKEN;
beforeAll(() => { process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN; });
afterAll(() => {
  if (ORIG_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIG_ADMIN;
});

function putEvent(roomId: string, docId: string, body: unknown, opts: { adminBearer?: boolean } = {}): AnyEvent {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/docs/${docId}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.adminBearer) headers.authorization = `Bearer ${ADMIN_TOKEN}`;
  return {
    request: new Request(url.toString(), { method: 'PUT', headers, body: JSON.stringify(body) }),
    params: { roomId, docId },
    url
  } as unknown as AnyEvent;
}
async function runPut(event: AnyEvent): Promise<Response> {
  try { return (await PUT(event)) as Response; }
  catch (e) {
    if (e instanceof Response) return e;
    const f = e as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw e;
  }
}

describe('PUT /api/chat-rooms/:roomId/docs/:docId — write-attribution anti-spoof', () => {
  beforeEach(() => {
    resetChatRoomArtefactContentStoreForTests();
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
  });

  function seedDoc() {
    const room = createChatRoom({ name: 'doc room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id, kind: 'doc', title: 'Notes',
      refUrl: `/api/chat-rooms/${room.id}/docs/d1`, createdBy: '@you'
    });
    return { room, artefact };
  }

  it('a non-admin caller CANNOT attribute the edit to another handle (403)', async () => {
    const { room, artefact } = seedDoc();
    const terminal = upsertTerminal({ pid: 88_101, pid_start: 'docs-spoof', name: 'agent-a', ttlSeconds: 3600 });
    addMembership({ room_id: room.id, handle: '@a', terminal_id: terminal.id });

    const res = await runPut(putEvent(room.id, 'd1', {
      artefactId: artefact.id, contentFormat: 'markdown', contentBody: '# hi',
      updatedByHandle: '@victim',
      pidChain: [{ pid: 88_101, pid_start: 'docs-spoof' }]
    }));

    expect(res.status).toBe(403);
    expect(getArtefactContentById('d1')).toBeNull();
  });

  it('a non-admin caller writing as THEMSELVES (or omitting) succeeds, attributed server-side', async () => {
    const { room, artefact } = seedDoc();
    const terminal = upsertTerminal({ pid: 88_102, pid_start: 'docs-self', name: 'agent-a', ttlSeconds: 3600 });
    addMembership({ room_id: room.id, handle: '@a', terminal_id: terminal.id });

    const res = await runPut(putEvent(room.id, 'd1', {
      artefactId: artefact.id, contentFormat: 'markdown', contentBody: '# mine',
      pidChain: [{ pid: 88_102, pid_start: 'docs-self' }]
    }));

    expect(res.status).toBe(200);
    expect(getArtefactContentById('d1')?.updatedByHandle).toBe('@a');
  });

  it('admin-bearer MAY attribute on behalf of another (automation path)', async () => {
    const { room, artefact } = seedDoc();
    const res = await runPut(putEvent(room.id, 'd1', {
      artefactId: artefact.id, contentFormat: 'markdown', contentBody: '# auto',
      updatedByHandle: '@speedycodex'
    }, { adminBearer: true }));

    expect(res.status).toBe(200);
    expect(getArtefactContentById('d1')?.updatedByHandle).toBe('@speedycodex');
  });
});
