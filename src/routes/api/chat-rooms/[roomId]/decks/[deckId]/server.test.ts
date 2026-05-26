import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createArtefactInRoom, resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import { resetChatRoomArtefactContentStoreForTests, upsertArtefactContent } from '$lib/server/chatRoomArtefactContentStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(roomId: string, deckId: string): AnyEvent {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/decks/${deckId}`);
  return {
    request: new Request(url.toString()),
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

describe('GET /api/chat-rooms/:roomId/decks/:deckId', () => {
  beforeEach(() => {
    resetChatRoomArtefactContentStoreForTests();
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
  });

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

    const response = await runGet(eventFor(room.id, 'univer-deck'));

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
});
