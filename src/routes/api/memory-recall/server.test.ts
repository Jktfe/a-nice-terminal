import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  postMessage,
  postBreakMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import {
  resetChairDigestNoteStoreForTests,
  setDigestNote
} from '$lib/server/chairDigestNoteStore';
import {
  recordAgentEvent,
  resetAgentTimelineStoreForTests
} from '$lib/server/agentTimelineStore';
import {
  resetChatAttachmentStoreForTests,
  shareFileInRoom
} from '$lib/server/chatAttachmentStore';
import {
  openAskInRoom,
  resetAskStoreForTests
} from '$lib/server/askStore';

const tinyBase64 = Buffer.from('slice 4 fixture').toString('base64');

async function callGet(rawUrl: string): Promise<Response> {
  const fullUrl = new URL(`http://localhost${rawUrl}`);
  const event = {
    request: new Request(fullUrl),
    params: {},
    url: fullUrl
  } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

describe('GET /api/memory-recall', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetChairDigestNoteStoreForTests();
    resetAgentTimelineStoreForTests();
    resetChatAttachmentStoreForTests();
    resetAskStoreForTests();
  });

  function seedAllFiveSurfaces(needle: string): string {
    const roomId = seedAllFourSurfaces(needle);
    openAskInRoom({
      roomId,
      openedByHandle: '@you',
      title: `${needle} ask title`,
      body: `${needle} ask body text`
    });
    return roomId;
  }

  function seedAllFourSurfaces(needle: string): string {
    const room = createChatRoom({ name: 'recall-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
    postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: `${needle} message text`
    });
    setDigestNote({ roomId: room.id, noteText: `${needle} note text` });
    recordAgentEvent({
      roomId: room.id,
      authorHandle: '@evolveantclaude',
      kind: 'tool-call',
      summary: `${needle} agent summary`
    });
    shareFileInRoom({
      roomId: room.id,
      filename: `${needle}-file.txt`,
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@evolveantclaude'
    });
    return room.id;
  }

  it('returns 200 with newest-first hits across kinds', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'shared keyword msg' });
    setDigestNote({ roomId: room.id, noteText: 'shared keyword note' });
    const response = await callGet('/api/memory-recall?query=shared%20keyword');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hits.length).toBe(2);
    const kinds = body.hits.map((hit: { kind: string }) => hit.kind).sort();
    expect(kinds).toEqual(['message', 'note']);
  });

  it('returns 400 when query is missing', async () => {
    const response = await callGet('/api/memory-recall');
    expect(response.status).toBe(400);
  });

  it('returns 400 when query is whitespace-only', async () => {
    const response = await callGet('/api/memory-recall?query=%20%20');
    expect(response.status).toBe(400);
  });

  it('returns 200 with empty hits when nothing matches', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    const response = await callGet('/api/memory-recall?query=banana');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hits).toEqual([]);
  });

  it('honours a small explicit limit', async () => {
    const room = createChatRoom({ name: 'few', whoCreatedIt: '@you' });
    for (let index = 0; index < 10; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const response = await callGet('/api/memory-recall?query=match&limit=4');
    const body = await response.json();
    expect(body.hits).toHaveLength(4);
  });

  it('ignores a non-numeric limit and uses the default', async () => {
    const room = createChatRoom({ name: 'lots', whoCreatedIt: '@you' });
    for (let index = 0; index < 60; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const response = await callGet('/api/memory-recall?query=match&limit=banana');
    const body = await response.json();
    expect(body.hits).toHaveLength(50);
  });

  it('returns 200 with empty hits when there are no rooms or notes', async () => {
    const response = await callGet('/api/memory-recall?query=anything');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hits).toEqual([]);
  });

  it('preserves the discriminator shape per hit', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'discriminator test' });
    const response = await callGet('/api/memory-recall?query=discriminator');
    const body = await response.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].kind).toBe('message');
    expect(body.hits[0].messageHit).toBeDefined();
    expect(typeof body.hits[0].occurredAtMillis).toBe('number');
  });

  describe('slice 4 ?surfaces parsing', () => {
    it('default (no ?surfaces) preserves message+note only even when all 4 surfaces match', async () => {
      seedAllFourSurfaces('compat');
      const response = await callGet('/api/memory-recall?query=compat');
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('agentEvent')).toBe(false);
      expect(kinds.has('file')).toBe(false);
    });

    it('surfaces=all returns hits from all four kinds', async () => {
      seedAllFourSurfaces('allsurf');
      const response = await callGet('/api/memory-recall?query=allsurf&surfaces=all');
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('agentEvent')).toBe(true);
      expect(kinds.has('file')).toBe(true);
    });

    it('surfaces=message,file returns the requested subset only', async () => {
      seedAllFourSurfaces('subset');
      const response = await callGet(
        '/api/memory-recall?query=subset&surfaces=message,file'
      );
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('file')).toBe(true);
      expect(kinds.has('note')).toBe(false);
      expect(kinds.has('agentEvent')).toBe(false);
    });

    it('surfaces=default is equivalent to missing surfaces', async () => {
      seedAllFourSurfaces('defaultkw');
      const response = await callGet(
        '/api/memory-recall?query=defaultkw&surfaces=default'
      );
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('agentEvent')).toBe(false);
      expect(kinds.has('file')).toBe(false);
    });

    it('whitespace-only surfaces= falls back to the default contract', async () => {
      seedAllFourSurfaces('whitespace');
      const response = await callGet(
        '/api/memory-recall?query=whitespace&surfaces=%20%20%20'
      );
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('agentEvent')).toBe(false);
      expect(kinds.has('file')).toBe(false);
    });

    it('surfaces with only unknown kinds falls back to the default contract', async () => {
      seedAllFourSurfaces('unknownonly');
      const response = await callGet(
        '/api/memory-recall?query=unknownonly&surfaces=fictional,nope'
      );
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      // Garbage-only input must NOT silently widen to "all".
      expect(kinds.has('agentEvent')).toBe(false);
      expect(kinds.has('file')).toBe(false);
      // And the known-kind defaults still apply.
      expect(kinds.has('message')).toBe(true);
    });

    it('file hits surfaced via surfaces=file carry metadata only', async () => {
      seedAllFourSurfaces('bytesguard');
      const response = await callGet(
        '/api/memory-recall?query=bytesguard&surfaces=file'
      );
      const body = await response.json();
      const fileHits = body.hits.filter((hit: { kind: string }) => hit.kind === 'file');
      expect(fileHits.length).toBeGreaterThan(0);
      for (const hit of fileHits) {
        expect('contentsBase64' in hit.fileHit).toBe(false);
      }
    });

    it('agentEvent + file hits include roomName resolved per-room', async () => {
      seedAllFourSurfaces('roomname');
      const response = await callGet(
        '/api/memory-recall?query=roomname&surfaces=agentEvent,file'
      );
      const body = await response.json();
      for (const hit of body.hits) {
        if (hit.kind === 'agentEvent' || hit.kind === 'file') {
          expect(hit.roomName).toBe('recall-room');
        }
      }
    });
  });

  describe('slice 6 ?surfaces=ask coverage', () => {
    it('default (no ?surfaces) still excludes ask hits when an open ask matches', async () => {
      seedAllFiveSurfaces('askdefault');
      const response = await callGet('/api/memory-recall?query=askdefault');
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('ask')).toBe(false);
    });

    it('surfaces=all returns hits from all five kinds including ask', async () => {
      seedAllFiveSurfaces('askall');
      const response = await callGet('/api/memory-recall?query=askall&surfaces=all');
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('agentEvent')).toBe(true);
      expect(kinds.has('file')).toBe(true);
      expect(kinds.has('ask')).toBe(true);
    });

    it('surfaces=ask returns only ask hits', async () => {
      seedAllFiveSurfaces('askonly');
      const response = await callGet('/api/memory-recall?query=askonly&surfaces=ask');
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('ask')).toBe(true);
      expect(kinds.has('message')).toBe(false);
      expect(kinds.has('note')).toBe(false);
      expect(kinds.has('agentEvent')).toBe(false);
      expect(kinds.has('file')).toBe(false);
    });

    it('surfaces=message,ask returns the comma subset only', async () => {
      seedAllFiveSurfaces('asksubset');
      const response = await callGet(
        '/api/memory-recall?query=asksubset&surfaces=message,ask'
      );
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('ask')).toBe(true);
      expect(kinds.has('note')).toBe(false);
      expect(kinds.has('agentEvent')).toBe(false);
      expect(kinds.has('file')).toBe(false);
    });

    it('file hits remain metadata-only when ask hits are present in the same response', async () => {
      seedAllFiveSurfaces('asksbytesguard');
      const response = await callGet(
        '/api/memory-recall?query=asksbytesguard&surfaces=all'
      );
      const body = await response.json();
      const fileHits = body.hits.filter((hit: { kind: string }) => hit.kind === 'file');
      const askHits = body.hits.filter((hit: { kind: string }) => hit.kind === 'ask');
      expect(fileHits.length).toBeGreaterThan(0);
      expect(askHits.length).toBeGreaterThan(0);
      for (const hit of fileHits) {
        expect('contentsBase64' in hit.fileHit).toBe(false);
      }
    });
  });

  describe('slice 8 ?roomId endpoint contract', () => {
    function seedTwoRoomsWithNeedle(needle: string): { roomA: string; roomB: string } {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: roomA.id, agentHandle: '@evolveantclaude' });
      inviteAgentToRoom({ roomId: roomB.id, agentHandle: '@evolveantclaude' });
      postMessage({ roomId: roomA.id, authorHandle: '@you', body: `${needle} alpha-msg` });
      postMessage({ roomId: roomB.id, authorHandle: '@you', body: `${needle} beta-msg` });
      setDigestNote({ roomId: roomA.id, noteText: `${needle} alpha-note` });
      setDigestNote({ roomId: roomB.id, noteText: `${needle} beta-note` });
      recordAgentEvent({
        roomId: roomA.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: `${needle} alpha-event`
      });
      recordAgentEvent({
        roomId: roomB.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: `${needle} beta-event`
      });
      shareFileInRoom({
        roomId: roomA.id,
        filename: `${needle}-alpha-file.txt`,
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@evolveantclaude'
      });
      shareFileInRoom({
        roomId: roomB.id,
        filename: `${needle}-beta-file.txt`,
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@evolveantclaude'
      });
      openAskInRoom({
        roomId: roomA.id,
        openedByHandle: '@you',
        title: `${needle} alpha-ask`,
        body: 'b'
      });
      openAskInRoom({
        roomId: roomB.id,
        openedByHandle: '@you',
        title: `${needle} beta-ask`,
        body: 'b'
      });
      return { roomA: roomA.id, roomB: roomB.id };
    }

    it('no ?roomId returns hits across all rooms (zero drift baseline)', async () => {
      seedTwoRoomsWithNeedle('s8zerodrift');
      const response = await callGet('/api/memory-recall?query=s8zerodrift');
      expect(response.status).toBe(200);
      const body = await response.json();
      // Default surfaces is message+note. Both rooms have message+note.
      const messageHits = body.hits.filter(
        (hit: { kind: string }) => hit.kind === 'message'
      );
      expect(messageHits.length).toBe(2);
    });

    it('?roomId=valid-room returns hits scoped to that room only', async () => {
      const { roomA } = seedTwoRoomsWithNeedle('s8scope');
      const response = await callGet(
        `/api/memory-recall?query=s8scope&roomId=${encodeURIComponent(roomA)}&surfaces=all`
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      // Every hit must reference roomA. No leak from roomB.
      for (const hit of body.hits) {
        const hitRoomId =
          hit.kind === 'message'
            ? hit.messageHit.roomId
            : hit.kind === 'note'
              ? hit.noteHit.roomId
              : hit.roomId;
        expect(hitRoomId).toBe(roomA);
      }
      // All 5 kinds should be present scoped to roomA.
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('agentEvent')).toBe(true);
      expect(kinds.has('file')).toBe(true);
      expect(kinds.has('ask')).toBe(true);
    });

    it('?roomId=other-room returns hits scoped to other-room (cross-room leak prevention)', async () => {
      const { roomB } = seedTwoRoomsWithNeedle('s8leak');
      const response = await callGet(
        `/api/memory-recall?query=s8leak&roomId=${encodeURIComponent(roomB)}&surfaces=all`
      );
      const body = await response.json();
      for (const hit of body.hits) {
        const hitRoomId =
          hit.kind === 'message'
            ? hit.messageHit.roomId
            : hit.kind === 'note'
              ? hit.noteHit.roomId
              : hit.roomId;
        expect(hitRoomId).toBe(roomB);
      }
    });

    it('?roomId=unknown-room returns 404 "Room not found."', async () => {
      seedTwoRoomsWithNeedle('s8unknown');
      const response = await callGet(
        '/api/memory-recall?query=s8unknown&roomId=this-room-does-not-exist'
      );
      expect(response.status).toBe(404);
    });

    it('?roomId=  (whitespace) is treated as absent (zero-drift fallback)', async () => {
      seedTwoRoomsWithNeedle('s8whitespace');
      const response = await callGet(
        '/api/memory-recall?query=s8whitespace&roomId=%20%20%20'
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      // Same shape as no-?roomId: messages from BOTH rooms.
      const messageHits = body.hits.filter(
        (hit: { kind: string }) => hit.kind === 'message'
      );
      expect(messageHits.length).toBe(2);
    });

    it('?roomId trims leading/trailing whitespace before lookup', async () => {
      const { roomA } = seedTwoRoomsWithNeedle('s8trim');
      const paddedRoomId = `  ${roomA}  `;
      const response = await callGet(
        `/api/memory-recall?query=s8trim&roomId=${encodeURIComponent(paddedRoomId)}`
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      const messageHits = body.hits.filter(
        (hit: { kind: string }) => hit.kind === 'message'
      );
      expect(messageHits).toHaveLength(1);
      expect(messageHits[0].messageHit.roomId).toBe(roomA);
    });

    it('?roomId combined with surfaces=ask returns only ask kind scoped', async () => {
      const { roomA } = seedTwoRoomsWithNeedle('s8askscope');
      const response = await callGet(
        `/api/memory-recall?query=s8askscope&roomId=${encodeURIComponent(roomA)}&surfaces=ask`
      );
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.size).toBe(1);
      expect(kinds.has('ask')).toBe(true);
      for (const hit of body.hits) {
        expect(hit.roomId).toBe(roomA);
      }
    });

    it('?roomId combined with surfaces=message,note returns scoped subset', async () => {
      const { roomA } = seedTwoRoomsWithNeedle('s8subset');
      const response = await callGet(
        `/api/memory-recall?query=s8subset&roomId=${encodeURIComponent(roomA)}&surfaces=message,note`
      );
      const body = await response.json();
      const kinds = new Set(body.hits.map((hit: { kind: string }) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('agentEvent')).toBe(false);
      expect(kinds.has('file')).toBe(false);
      expect(kinds.has('ask')).toBe(false);
    });

    it('?roomId combined with limit applies limit AFTER scoped merge/sort', async () => {
      const room = createChatRoom({ name: 'Limit Endpoint Room', whoCreatedIt: '@you' });
      for (let index = 0; index < 8; index = index + 1) {
        postMessage({
          roomId: room.id,
          authorHandle: '@you',
          body: `s8limit msg ${index}`
        });
      }
      const response = await callGet(
        `/api/memory-recall?query=s8limit&roomId=${encodeURIComponent(room.id)}&limit=3`
      );
      const body = await response.json();
      expect(body.hits).toHaveLength(3);
    });

    it('?roomId scoped file hits remain metadata-only (no contentsBase64)', async () => {
      const { roomA } = seedTwoRoomsWithNeedle('s8filemeta');
      const response = await callGet(
        `/api/memory-recall?query=s8filemeta&roomId=${encodeURIComponent(roomA)}&surfaces=file`
      );
      const body = await response.json();
      const fileHits = body.hits.filter((hit: { kind: string }) => hit.kind === 'file');
      expect(fileHits.length).toBeGreaterThan(0);
      for (const hit of fileHits) {
        expect('contentsBase64' in hit.fileHit).toBe(false);
      }
    });
  });

  describe('long-memory break scope', () => {
    it('room-scoped recall defaults to messages since the latest break', async () => {
      const room = createChatRoom({ name: 'Long Memory Room', whoCreatedIt: '@you' });
      postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'boundaryword before break'
      });
      postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'fresh lane' });
      postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'boundaryword after break'
      });

      const response = await callGet(
        `/api/memory-recall?query=boundaryword&roomId=${encodeURIComponent(room.id)}&surfaces=message`
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      const messageBodies = body.hits.map(
        (hit: { messageHit: { message: { body: string } } }) => hit.messageHit.message.body
      );
      expect(messageBodies).toEqual(['boundaryword after break']);
      expect(body.longMemory).toBe(false);
    });

    it('longMemory=1 room-scoped recall searches before the latest break too', async () => {
      const room = createChatRoom({ name: 'Long Memory Full Room', whoCreatedIt: '@you' });
      postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'fullhistory before break'
      });
      postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'fresh lane' });
      postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'fullhistory after break'
      });

      const response = await callGet(
        `/api/memory-recall?query=fullhistory&roomId=${encodeURIComponent(room.id)}&surfaces=message&longMemory=1`
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      const messageBodies = body.hits.map(
        (hit: { messageHit: { message: { body: string } } }) => hit.messageHit.message.body
      );
      expect(messageBodies).toEqual([
        'fullhistory after break',
        'fullhistory before break'
      ]);
      expect(body.longMemory).toBe(true);
    });
  });
});
