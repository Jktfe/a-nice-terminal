import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
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
