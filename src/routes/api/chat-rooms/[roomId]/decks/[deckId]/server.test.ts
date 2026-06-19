import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, PUT } from './+server';
import { createArtefactInRoom, resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import {
  getArtefactContentById,
  resetChatRoomArtefactContentStoreForTests,
  upsertArtefactContent
} from '$lib/server/chatRoomArtefactContentStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(roomId: string, deckId: string, init?: RequestInit): AnyEvent {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/decks/${deckId}`);
  return {
    request: new Request(url.toString(), init),
    params: { roomId, deckId },
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

async function runPut(event: AnyEvent): Promise<Response> {
  try {
    return (await PUT(event as Parameters<typeof PUT>[0])) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('GET /api/chat-rooms/:roomId/decks/:deckId', () => {
  const CONTENT_ADMIN_TOKEN = 'decks-content-test-admin-token';
  const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
  beforeAll(() => {
    process.env.ANT_ADMIN_TOKEN = CONTENT_ADMIN_TOKEN;
  });
  afterAll(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  });
  beforeEach(() => {
    resetChatRoomArtefactContentStoreForTests();
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
  });

  function adminReadInit(): RequestInit {
    return { headers: { authorization: `Bearer ${CONTENT_ADMIN_TOKEN}` } };
  }

  it('renders univer-json deck content instead of returning the old 501 placeholder', async () => {
    const room = createChatRoom({ name: 'deck room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'deck',
      title: 'Shared Univer Deck',
      refUrl: `/api/chat-rooms/${room.id}/decks/univer-deck`,
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'univer-deck',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'deck',
      contentFormat: 'univer-json',
      contentBody: JSON.stringify({
        pageOrder: ['slide-1'],
        pages: {
          'slide-1': {
            title: 'Where ANT is now',
            pageElements: {
              headline: { type: 'text', text: 'Rooms, Stage, validation, and app handoffs' },
              unsafe: { type: 'text', text: '<script>alert("x")</script>' }
            }
          }
        }
      }),
      updatedByHandle: '@speedycodex'
    });

    const response = await runGet(eventFor(room.id, 'univer-deck', adminReadInit()));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Univer JSON Deck');
    expect(html).toContain('Where ANT is now');
    expect(html).toContain('Rooms, Stage, validation, and app handoffs');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).not.toContain('not yet implemented');
  });

  it('rejects anonymous rendered deck reads for ordinary room decks', async () => {
    const room = createChatRoom({ name: 'private deck room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'deck',
      title: 'Private Deck',
      refUrl: `/api/chat-rooms/${room.id}/decks/private-deck`,
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'private-deck',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'deck',
      contentFormat: 'markdown',
      contentBody: '# private',
      updatedByHandle: '@speedycodex'
    });

    const response = await runGet(eventFor(room.id, 'private-deck'));

    expect(response.status).toBe(401);
  });

  it('lets the seeded Univer demo deck autosave without room auth', async () => {
    const room = createChatRoom({ name: 'speed matters', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      id: 'univer_demo_5892abff',
      roomId: room.id,
      kind: 'deck',
      title: 'Univer Demo Deck',
      refUrl: `/api/chat-rooms/${room.id}/decks/univer_demo_content_2f3cbf38`,
      createdBy: '@speedycodex'
    });

    const response = await runPut(eventFor(room.id, 'univer_demo_content_2f3cbf38', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        artefactId: artefact.id,
        contentFormat: 'univer-json',
        contentBody: '{"id":"demo-deck"}'
      })
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('univer_demo_content_2f3cbf38');
    expect(body.contentBody).toBe('{"id":"demo-deck"}');
  });

  it('lets the canonical-shape Univer demo deck autosave without room auth', async () => {
    const room = createChatRoom({ name: 'speed matters', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      id: 'univer-demo-test-deck-2297',
      roomId: room.id,
      kind: 'deck',
      title: 'Canonical Univer Demo Deck',
      refUrl: `/api/chat-rooms/${room.id}/decks/univer-univer-demo-test-deck-2297`,
      createdBy: '@speedyclaude'
    });

    const response = await runPut(eventFor(room.id, 'univer-univer-demo-test-deck-2297', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        artefactId: artefact.id,
        contentFormat: 'univer-json',
        contentBody: '{"id":"canonical-demo-deck"}'
      })
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('univer-univer-demo-test-deck-2297');
    expect(body.contentBody).toBe('{"id":"canonical-demo-deck"}');
  });

  it('still rejects anonymous autosave for ordinary decks', async () => {
    const room = createChatRoom({ name: 'private deck room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'deck',
      title: 'Private Deck',
      refUrl: `/api/chat-rooms/${room.id}/decks/private-deck`,
      createdBy: '@speedycodex'
    });

    const response = await runPut(eventFor(room.id, 'private-deck', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        artefactId: artefact.id,
        contentFormat: 'univer-json',
        contentBody: '{"id":"private-deck"}'
      })
    }));

    expect(response.status).toBe(401);
  });
});

describe('PUT /api/chat-rooms/:roomId/decks/:deckId — write-attribution anti-spoof', () => {
  const ADMIN_TOKEN = 'decks-put-test-admin-token';
  const ORIG_ADMIN = process.env.ANT_ADMIN_TOKEN;
  beforeAll(() => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  });
  afterAll(() => {
    if (ORIG_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIG_ADMIN;
  });
  beforeEach(() => {
    resetChatRoomArtefactContentStoreForTests();
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
  });

  function seedDeck() {
    const room = createChatRoom({ name: 'deck room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'deck',
      title: 'Deck',
      refUrl: `/api/chat-rooms/${room.id}/decks/dk1`,
      createdBy: '@you'
    });
    return { room, artefact };
  }

  function putInit(body: unknown, opts: { adminBearer?: boolean } = {}): RequestInit {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.adminBearer) headers.authorization = `Bearer ${ADMIN_TOKEN}`;
    return { method: 'PUT', headers, body: JSON.stringify(body) };
  }

  it('a non-admin caller CANNOT attribute the edit to another handle (403)', async () => {
    const { room, artefact } = seedDeck();
    const terminal = upsertTerminal({ pid: 77_201, pid_start: 'decks-spoof', name: 'agent-a', ttlSeconds: 3600 });
    addMembership({ room_id: room.id, handle: '@a', terminal_id: terminal.id });

    const res = await runPut(eventFor(room.id, 'dk1', putInit({
      artefactId: artefact.id, contentFormat: 'markdown', contentBody: '# hi',
      updatedByHandle: '@victim',
      pidChain: [{ pid: 77_201, pid_start: 'decks-spoof' }]
    })));

    expect(res.status).toBe(403);
    expect(getArtefactContentById('dk1')).toBeNull();
  });

  it('a non-admin caller writing as THEMSELVES is attributed server-side', async () => {
    const { room, artefact } = seedDeck();
    const terminal = upsertTerminal({ pid: 77_202, pid_start: 'decks-self', name: 'agent-a', ttlSeconds: 3600 });
    addMembership({ room_id: room.id, handle: '@a', terminal_id: terminal.id });

    const res = await runPut(eventFor(room.id, 'dk1', putInit({
      artefactId: artefact.id, contentFormat: 'markdown', contentBody: '# mine',
      pidChain: [{ pid: 77_202, pid_start: 'decks-self' }]
    })));

    expect(res.status).toBe(200);
    expect(getArtefactContentById('dk1')?.updatedByHandle).toBe('@a');
  });

  it('admin-bearer MAY attribute on behalf of another (automation path)', async () => {
    const { room, artefact } = seedDeck();
    const res = await runPut(eventFor(room.id, 'dk1', putInit({
      artefactId: artefact.id, contentFormat: 'markdown', contentBody: '# auto',
      updatedByHandle: '@speedycodex'
    }, { adminBearer: true })));

    expect(res.status).toBe(200);
    expect(getArtefactContentById('dk1')?.updatedByHandle).toBe('@speedycodex');
  });

  it('the seeded-demo bypass never trusts a client-supplied updatedByHandle', async () => {
    const room = createChatRoom({ name: 'demo', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      id: 'univer_demo_aa11',
      roomId: room.id,
      kind: 'deck',
      title: 'Demo',
      refUrl: `/api/chat-rooms/${room.id}/decks/univer_demo_content_aa11`,
      createdBy: '@you'
    });

    const res = await runPut(eventFor(room.id, 'univer_demo_content_aa11', putInit({
      artefactId: artefact.id, contentFormat: 'univer-json', contentBody: '{"id":"d"}',
      updatedByHandle: '@victim'
    })));

    expect(res.status).toBe(200);
    expect(getArtefactContentById('univer_demo_content_aa11')?.updatedByHandle).toBeNull();
  });
});
