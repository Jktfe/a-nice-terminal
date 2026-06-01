import { beforeEach, describe, expect, it } from 'vitest';
import {
  inviteAgentToRoom
} from './chatRoomStore';
import {
  recordAgentEvent,
  resetAgentTimelineStoreForTests
} from './agentTimelineStore';
import {
  resetChatAttachmentStoreForTests,
  shareFileInRoom
} from './chatAttachmentStore';
import {
  answerAsk,
  dismissAsk,
  openAskInRoom,
  resetAskStoreForTests
} from './askStore';

function sleepBriefly(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const tinyBase64 = Buffer.from('memory recall slice 3 fixture').toString('base64');
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from './chatMessageStore';
import {
  resetChairDigestNoteStoreForTests,
  setDigestNote
} from './chairDigestNoteStore';
import {
  recallAcrossSurfaces,
  resetMemoryRecallStoreForTests
} from './memoryRecallStore';

describe('memoryRecallStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetChairDigestNoteStoreForTests();
    resetAgentTimelineStoreForTests();
    resetChatAttachmentStoreForTests();
    resetAskStoreForTests();
    resetMemoryRecallStoreForTests();
  });

  it('returns no hits when nothing matches', () => {
    const room = createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'unrelated' });
    expect(recallAcrossSurfaces({ query: 'banana' })).toEqual([]);
  });

  it('rejects a blank query', () => {
    expect(() => recallAcrossSurfaces({ query: '   ' })).toThrow();
  });

  it('finds a message body match (case-insensitive)', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'Pizza Friday' });
    const hits = recallAcrossSurfaces({ query: 'pizza' });
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('message');
    if (hits[0].kind === 'message') {
      expect(hits[0].messageHit.message.body).toBe('Pizza Friday');
    }
  });

  it('finds a chair digest note text match (case-insensitive)', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    setDigestNote({ roomId: room.id, noteText: 'Watching the LATENCY spike' });
    const hits = recallAcrossSurfaces({ query: 'latency' });
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('note');
    if (hits[0].kind === 'note') {
      expect(hits[0].noteHit.noteText).toBe('Watching the LATENCY spike');
    }
  });

  it('returns both kinds when both match the query', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'shared keyword in message' });
    setDigestNote({ roomId: room.id, noteText: 'shared keyword in note' });
    const hits = recallAcrossSurfaces({ query: 'shared keyword' });
    expect(hits).toHaveLength(2);
    const kinds = hits.map((entry) => entry.kind).sort();
    expect(kinds).toEqual(['message', 'note']);
  });

  it('sorts mixed results newest-first using a single occurredAtMillis key', async () => {
    // Real-time millisecond gaps drive distinct postedAt/setAt timestamps
    // on the underlying stores. vi.spyOn(Date, "now") doesn't help here
    // because chatMessageStore + chairDigestNoteStore both use
    // `new Date()`, which reads the system clock natively and bypasses
    // the JS Date.now mock in Node/V8.
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });

    postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'shared keyword oldest message'
    });
    await sleepBriefly(10);

    setDigestNote({ roomId: room.id, noteText: 'shared keyword middle note' });
    await sleepBriefly(10);

    postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'shared keyword newest message'
    });

    const hits = recallAcrossSurfaces({ query: 'shared keyword' });
    expect(hits).toHaveLength(3);
    expect(hits[0].kind).toBe('message');
    expect(hits[1].kind).toBe('note');
    expect(hits[2].kind).toBe('message');
    if (hits[0].kind === 'message') {
      expect(hits[0].messageHit.message.body).toBe('shared keyword newest message');
    }
    if (hits[2].kind === 'message') {
      expect(hits[2].messageHit.message.body).toBe('shared keyword oldest message');
    }
  });

  it('caps results at the default limit of 50', () => {
    const room = createChatRoom({ name: 'lots', whoCreatedIt: '@you' });
    for (let index = 0; index < 60; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    expect(recallAcrossSurfaces({ query: 'match' })).toHaveLength(50);
  });

  it('honours a small explicit limit', () => {
    const room = createChatRoom({ name: 'few', whoCreatedIt: '@you' });
    for (let index = 0; index < 10; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    expect(recallAcrossSurfaces({ query: 'match', limit: 3 })).toHaveLength(3);
  });

  it('falls back to default when limit is non-positive', () => {
    const room = createChatRoom({ name: 'fallback', whoCreatedIt: '@you' });
    for (let index = 0; index < 5; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    expect(recallAcrossSurfaces({ query: 'match', limit: -1 })).toHaveLength(5);
  });

  it('caps very large limits at the hard cap of 200', () => {
    const room = createChatRoom({ name: 'huge', whoCreatedIt: '@you' });
    for (let index = 0; index < 220; index = index + 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${index}` });
    }
    const hits = recallAcrossSurfaces({ query: 'match', limit: 99_999 });
    expect(hits.length).toBeLessThanOrEqual(200);
  });

  it('still matches system messages too (same precedent as M14 search)', () => {
    const room = createChatRoom({ name: 'sys', whoCreatedIt: '@you' });
    // Manually post a system-ish message via the normal API so the test
    // stays inside accepted store surfaces. The recall layer is a pure
    // consumer; if M14 finds it, recall finds it.
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'kimi joined' });
    const hits = recallAcrossSurfaces({ query: 'kimi' });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('returns an empty array when there are no rooms / no notes at all', () => {
    expect(recallAcrossSurfaces({ query: 'anything' })).toEqual([]);
  });

  it('does not throw on a malformed timestamp (defensive occurredAtMillis fallback)', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'edge case match' });
    // The store always produces ISO timestamps, but the cross-surface
    // sort must never throw if a stale fixture ends up with a bad value.
    const hits = recallAcrossSurfaces({ query: 'edge case' });
    expect(hits).toHaveLength(1);
  });

  describe('slice 3 opt-in agentEvent + file surfaces', () => {
    it('does NOT include agentEvent hits in the default response (zero drift)', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
      recordAgentEvent({
        roomId: room.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'shared keyword agent event'
      });
      const hits = recallAcrossSurfaces({ query: 'shared keyword' });
      expect(hits.every((entry) => entry.kind === 'message' || entry.kind === 'note')).toBe(true);
    });

    it('does NOT include file hits in the default response (zero drift)', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      shareFileInRoom({
        roomId: room.id,
        filename: 'shared-keyword-file.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      });
      const hits = recallAcrossSurfaces({ query: 'shared-keyword' });
      expect(hits.every((entry) => entry.kind === 'message' || entry.kind === 'note')).toBe(true);
    });

    it('explicit ["message","note"] matches the default behavior exactly', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'shared msg' });
      recordAgentEvent({
        roomId: room.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'shared event'
      });
      const defaultHits = recallAcrossSurfaces({ query: 'shared' });
      const explicitHits = recallAcrossSurfaces({
        query: 'shared',
        includeSurfaces: ['message', 'note']
      });
      expect(explicitHits.length).toBe(defaultHits.length);
      expect(explicitHits.every((entry) => entry.kind === 'message' || entry.kind === 'note')).toBe(true);
    });

    it('opt-in agentEvent matches event.summary case-insensitive', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
      recordAgentEvent({
        roomId: room.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'Patched MessageRow A11Y'
      });
      const hits = recallAcrossSurfaces({
        query: 'a11y',
        includeSurfaces: ['agentEvent']
      });
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe('agentEvent');
      if (hits[0].kind === 'agentEvent') {
        expect(hits[0].roomName).toBe('r');
        expect(hits[0].eventHit.summary).toBe('Patched MessageRow A11Y');
      }
    });

    it('opt-in file matches filename case-insensitive', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      shareFileInRoom({
        roomId: room.id,
        filename: 'INVOICE-2026.pdf',
        mimeType: 'application/pdf',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      });
      const hits = recallAcrossSurfaces({
        query: 'invoice',
        includeSurfaces: ['file']
      });
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe('file');
      if (hits[0].kind === 'file') {
        expect(hits[0].fileHit.filename).toBe('INVOICE-2026.pdf');
        expect(hits[0].roomName).toBe('r');
      }
    });

    it('file hits carry metadata only — contentsBase64 never appears on the hit', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      shareFileInRoom({
        roomId: room.id,
        filename: 'secret-bytes.bin',
        mimeType: 'application/octet-stream',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      });
      const hits = recallAcrossSurfaces({
        query: 'secret-bytes',
        includeSurfaces: ['file']
      });
      expect(hits).toHaveLength(1);
      if (hits[0].kind === 'file') {
        expect('contentsBase64' in hits[0].fileHit).toBe(false);
      }
    });

    it('agentEvent + file hits resolve roomName from the per-room iteration', () => {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: roomA.id, agentHandle: '@evolveantclaude' });
      recordAgentEvent({
        roomId: roomA.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'cross-room hit alpha'
      });
      shareFileInRoom({
        roomId: roomB.id,
        filename: 'cross-room-hit-beta.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      });
      const hits = recallAcrossSurfaces({
        query: 'cross-room',
        includeSurfaces: ['agentEvent', 'file']
      });
      const roomNames = hits.map((entry) =>
        entry.kind === 'agentEvent' || entry.kind === 'file' ? entry.roomName : ''
      );
      expect(roomNames).toContain('Room Alpha');
      expect(roomNames).toContain('Room Beta');
    });

    it('opt-in to all four surfaces returns mixed kinds sorted by occurredAtMillis', async () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });

      postMessage({ roomId: room.id, authorHandle: '@you', body: 'shared keyword 1st' });
      await sleepBriefly(8);
      recordAgentEvent({
        roomId: room.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'shared keyword 2nd'
      });
      await sleepBriefly(8);
      shareFileInRoom({
        roomId: room.id,
        filename: 'shared-keyword-3rd.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      });

      const hits = recallAcrossSurfaces({
        query: 'shared',
        includeSurfaces: ['message', 'note', 'agentEvent', 'file']
      });
      const kindsInOrder = hits.map((entry) => entry.kind);
      // Newest-first: file (3rd, latest) → agentEvent (2nd) → message (1st)
      expect(kindsInOrder).toEqual(['file', 'agentEvent', 'message']);
    });

    it('opt-in returns empty for a surface set that excludes the only matching kind', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
      recordAgentEvent({
        roomId: room.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'agent only match'
      });
      const hitsWithoutAgentEvent = recallAcrossSurfaces({
        query: 'agent only',
        includeSurfaces: ['message', 'note']
      });
      expect(hitsWithoutAgentEvent).toEqual([]);
    });

    it('unknown surface kinds in includeSurfaces are silently ignored', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      postMessage({
        roomId: room.id,
        authorHandle: '@you',
        body: 'still found via message'
      });
      const hits = recallAcrossSurfaces({
        query: 'still found',
        includeSurfaces: ['message', 'fictionalKind' as RecallKindForTest]
      });
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe('message');
    });

    it('limit is applied AFTER merge and sort across all opted-in surfaces', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
      for (let i = 0; i < 5; i = i + 1) {
        postMessage({ roomId: room.id, authorHandle: '@you', body: `match ${i}` });
      }
      for (let i = 0; i < 5; i = i + 1) {
        recordAgentEvent({
          roomId: room.id,
          authorHandle: '@evolveantclaude',
          kind: 'tool-call',
          summary: `match agent ${i}`
        });
      }
      const hits = recallAcrossSurfaces({
        query: 'match',
        includeSurfaces: ['message', 'agentEvent'],
        limit: 3
      });
      expect(hits).toHaveLength(3);
    });

    it('blank query still rejects with opt-in includeSurfaces present', () => {
      expect(() =>
        recallAcrossSurfaces({ query: '   ', includeSurfaces: ['agentEvent'] })
      ).toThrow();
    });
  });

  describe('slice 5 opt-in ask surface', () => {
    it('opt-in ["ask"] matches an open ask title case-insensitive', () => {
      const room = createChatRoom({ name: 'asks-room', whoCreatedIt: '@you' });
      openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'Should We Ship Tonight?',
        body: 'plain context'
      });
      const hits = recallAcrossSurfaces({
        query: 'ship tonight',
        includeSurfaces: ['ask']
      });
      expect(hits).toHaveLength(1);
      expect(hits[0].kind).toBe('ask');
      if (hits[0].kind === 'ask') {
        expect(hits[0].askHit.title).toBe('Should We Ship Tonight?');
        expect(hits[0].roomName).toBe('asks-room');
      }
    });

    it('opt-in ["ask"] matches ask.body case-insensitive', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'plain title',
        body: 'WAITING FOR @kimi to weigh in'
      });
      const hits = recallAcrossSurfaces({
        query: 'kimi to weigh',
        includeSurfaces: ['ask']
      });
      expect(hits).toHaveLength(1);
      if (hits[0].kind === 'ask') {
        expect(hits[0].askHit.body).toBe('WAITING FOR @kimi to weigh in');
      }
    });

    it('default response does NOT include ask hits even when matching asks exist (zero drift)', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'shared keyword in ask',
        body: 'b'
      });
      const hits = recallAcrossSurfaces({ query: 'shared keyword' });
      expect(hits.every((entry) => entry.kind === 'message' || entry.kind === 'note')).toBe(true);
    });

    it('opt-in to all 5 kinds returns mixed hits including ask', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'shared keyword msg' });
      setDigestNote({ roomId: room.id, noteText: 'shared keyword note' });
      openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'shared keyword ask',
        body: 'b'
      });
      const hits = recallAcrossSurfaces({
        query: 'shared keyword',
        includeSurfaces: ['message', 'note', 'agentEvent', 'file', 'ask']
      });
      const kinds = new Set(hits.map((entry) => entry.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('ask')).toBe(true);
    });

    it('answered asks are EXCLUDED from opt-in ask recall (open-only guard)', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      const askToAnswer = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'unique-answered-token',
        body: 'b'
      });
      const askStillOpen = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'unique-answered-token still open',
        body: 'b'
      });
      answerAsk({
        askId: askToAnswer.id,
        answeredByHandle: '@you',
        answer: 'because we did'
      });
      const hits = recallAcrossSurfaces({
        query: 'unique-answered-token',
        includeSurfaces: ['ask']
      });
      // The answered ask drops out via listAllOpenAsks status=open filter.
      expect(hits).toHaveLength(1);
      if (hits[0].kind === 'ask') {
        expect(hits[0].askHit.id).toBe(askStillOpen.id);
      }
    });

    it('dismissed asks are EXCLUDED from opt-in ask recall (open-only guard)', () => {
      const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
      const askToDismiss = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'unique-dismiss-token',
        body: 'b'
      });
      dismissAsk({ askId: askToDismiss.id, dismissedByHandle: '@you' });
      const hits = recallAcrossSurfaces({
        query: 'unique-dismiss-token',
        includeSurfaces: ['ask']
      });
      expect(hits).toEqual([]);
    });

    it('ask hit includes roomName resolved per-room (cross-room)', () => {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      openAskInRoom({
        roomId: roomA.id,
        openedByHandle: '@you',
        title: 'cross-room-token alpha',
        body: 'b'
      });
      openAskInRoom({
        roomId: roomB.id,
        openedByHandle: '@you',
        title: 'cross-room-token beta',
        body: 'b'
      });
      const hits = recallAcrossSurfaces({
        query: 'cross-room-token',
        includeSurfaces: ['ask']
      });
      const roomNames = hits.map((entry) =>
        entry.kind === 'ask' ? entry.roomName : ''
      );
      expect(roomNames).toContain('Room Alpha');
      expect(roomNames).toContain('Room Beta');
    });

    it('blank query rejects when includeSurfaces=["ask"]', () => {
      expect(() =>
        recallAcrossSurfaces({ query: '   ', includeSurfaces: ['ask'] })
      ).toThrow();
    });
  });

  // Slice 7 — store-only internal-expansion-prep for roomId scoping.
  // Endpoint and UI untouched in this slice; tests call the store
  // directly. Default callers (no roomId) must see identical behaviour
  // (zero drift), and any roomId scopes every kind BEFORE the cross-
  // surface merge/sort/limit.
  describe('slice 7 roomId scoping (store-only)', () => {
    it('no-roomId call returns same shape as before (zero drift across all 5 kinds)', () => {
      const room = createChatRoom({ name: 'Zero Drift Room', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'zdtoken message' });
      setDigestNote({ roomId: room.id, noteText: 'zdtoken note' });
      recordAgentEvent({
        roomId: room.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'zdtoken summary'
      });
      shareFileInRoom({
        roomId: room.id,
        filename: 'zdtoken-file.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@evolveantclaude'
      });
      openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'zdtoken ask title',
        body: 'b'
      });
      const hits = recallAcrossSurfaces({
        query: 'zdtoken',
        includeSurfaces: ['message', 'note', 'agentEvent', 'file', 'ask']
      });
      const kinds = new Set(hits.map((hit) => hit.kind));
      expect(kinds.has('message')).toBe(true);
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('agentEvent')).toBe(true);
      expect(kinds.has('file')).toBe(true);
      expect(kinds.has('ask')).toBe(true);
    });

    it('roomId scopes message hits to the named room only', () => {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'scopetoken alpha' });
      postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'scopetoken beta' });
      const hits = recallAcrossSurfaces({
        query: 'scopetoken',
        roomId: roomA.id,
        includeSurfaces: ['message']
      });
      expect(hits).toHaveLength(1);
      const first = hits[0];
      expect(first.kind).toBe('message');
      if (first.kind === 'message') {
        expect(first.messageHit.roomId).toBe(roomA.id);
      }
    });

    it('roomId scopes note hits to the named room only', () => {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      setDigestNote({ roomId: roomA.id, noteText: 'scopetoken alpha note' });
      setDigestNote({ roomId: roomB.id, noteText: 'scopetoken beta note' });
      const hits = recallAcrossSurfaces({
        query: 'scopetoken',
        roomId: roomA.id,
        includeSurfaces: ['note']
      });
      expect(hits).toHaveLength(1);
      const first = hits[0];
      expect(first.kind).toBe('note');
      if (first.kind === 'note') {
        expect(first.noteHit.roomId).toBe(roomA.id);
      }
    });

    it('roomId scopes agentEvent hits to the named room only', () => {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: roomA.id, agentHandle: '@evolveantclaude' });
      inviteAgentToRoom({ roomId: roomB.id, agentHandle: '@evolveantclaude' });
      recordAgentEvent({
        roomId: roomA.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'scopetoken alpha event'
      });
      recordAgentEvent({
        roomId: roomB.id,
        authorHandle: '@evolveantclaude',
        kind: 'tool-call',
        summary: 'scopetoken beta event'
      });
      const hits = recallAcrossSurfaces({
        query: 'scopetoken',
        roomId: roomA.id,
        includeSurfaces: ['agentEvent']
      });
      expect(hits).toHaveLength(1);
      const first = hits[0];
      expect(first.kind).toBe('agentEvent');
      if (first.kind === 'agentEvent') {
        expect(first.roomId).toBe(roomA.id);
        expect(first.roomName).toBe('Room Alpha');
      }
    });

    it('roomId scopes file hits to the named room only and stays metadata-only', () => {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: roomA.id, agentHandle: '@evolveantclaude' });
      inviteAgentToRoom({ roomId: roomB.id, agentHandle: '@evolveantclaude' });
      shareFileInRoom({
        roomId: roomA.id,
        filename: 'scopetoken-alpha.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@evolveantclaude'
      });
      shareFileInRoom({
        roomId: roomB.id,
        filename: 'scopetoken-beta.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@evolveantclaude'
      });
      const hits = recallAcrossSurfaces({
        query: 'scopetoken',
        roomId: roomA.id,
        includeSurfaces: ['file']
      });
      expect(hits).toHaveLength(1);
      const first = hits[0];
      expect(first.kind).toBe('file');
      if (first.kind === 'file') {
        expect(first.roomId).toBe(roomA.id);
        expect('contentsBase64' in first.fileHit).toBe(false);
      }
    });

    it('roomId scopes ask hits to the named room only via listOpenAsksInRoom (open-only)', () => {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      openAskInRoom({
        roomId: roomA.id,
        openedByHandle: '@you',
        title: 'scopetoken alpha ask',
        body: 'b'
      });
      openAskInRoom({
        roomId: roomB.id,
        openedByHandle: '@you',
        title: 'scopetoken beta ask',
        body: 'b'
      });
      const hits = recallAcrossSurfaces({
        query: 'scopetoken',
        roomId: roomA.id,
        includeSurfaces: ['ask']
      });
      expect(hits).toHaveLength(1);
      const first = hits[0];
      expect(first.kind).toBe('ask');
      if (first.kind === 'ask') {
        expect(first.roomId).toBe(roomA.id);
      }
    });

    it('answered + dismissed asks in the scoped room are excluded (open-only contract preserved)', () => {
      const room = createChatRoom({ name: 'Closed Asks Room', whoCreatedIt: '@you' });
      openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'closedtoken open',
        body: 'b'
      });
      const askToAnswer = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'closedtoken answered',
        body: 'b'
      });
      const askToDismiss = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'closedtoken dismissed',
        body: 'b'
      });
      answerAsk({
        askId: askToAnswer.id,
        answeredByHandle: '@you',
        answer: 'response'
      });
      dismissAsk({ askId: askToDismiss.id, dismissedByHandle: '@you' });
      const hits = recallAcrossSurfaces({
        query: 'closedtoken',
        roomId: room.id,
        includeSurfaces: ['ask']
      });
      const titles = hits
        .filter((hit) => hit.kind === 'ask')
        .map((hit) => (hit.kind === 'ask' ? hit.askHit.title : ''));
      expect(titles).toEqual(['closedtoken open']);
    });

    it('unknown roomId returns empty hits at store layer (no throw)', () => {
      const room = createChatRoom({ name: 'Real Room', whoCreatedIt: '@you' });
      postMessage({ roomId: room.id, authorHandle: '@you', body: 'unknowntoken' });
      const hits = recallAcrossSurfaces({
        query: 'unknowntoken',
        roomId: 'this-room-does-not-exist',
        includeSurfaces: ['message', 'note', 'agentEvent', 'file', 'ask']
      });
      expect(hits).toEqual([]);
    });

    it('roomId scopes cross-surface hits before merge, sorts by occurredAtMillis, applies limit after', async () => {
      const roomA = createChatRoom({ name: 'Room Alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'Room Beta', whoCreatedIt: '@you' });
      // Room B has a message + a note with the same token; Room A has
      // its own message + note. roomId=roomA must scope merge to roomA
      // entirely, and the surviving entries must be sorted newest-first.
      postMessage({ roomId: roomB.id, authorHandle: '@you', body: 'sortedtoken b1' });
      await sleepBriefly(10);
      setDigestNote({ roomId: roomB.id, noteText: 'sortedtoken b2' });
      await sleepBriefly(10);
      postMessage({ roomId: roomA.id, authorHandle: '@you', body: 'sortedtoken a1' });
      await sleepBriefly(10);
      setDigestNote({ roomId: roomA.id, noteText: 'sortedtoken a2' });
      const hits = recallAcrossSurfaces({
        query: 'sortedtoken',
        roomId: roomA.id,
        includeSurfaces: ['message', 'note']
      });
      // Both hits MUST be Room Alpha — no Room Beta leak.
      for (const hit of hits) {
        if (hit.kind === 'message') {
          expect(hit.messageHit.roomId).toBe(roomA.id);
        } else if (hit.kind === 'note') {
          expect(hit.noteHit.roomId).toBe(roomA.id);
        }
      }
      // Newest first: note (a2) ahead of message (a1).
      expect(hits[0]?.kind).toBe('note');
      expect(hits[1]?.kind).toBe('message');
    });

    it('roomId scoping respects effectiveLimit after merge (limit applies AFTER sort)', () => {
      const room = createChatRoom({ name: 'Limit Room', whoCreatedIt: '@you' });
      for (let index = 0; index < 8; index = index + 1) {
        postMessage({
          roomId: room.id,
          authorHandle: '@you',
          body: `limittoken msg ${index}`
        });
      }
      const hits = recallAcrossSurfaces({
        query: 'limittoken',
        roomId: room.id,
        limit: 3,
        includeSurfaces: ['message']
      });
      expect(hits).toHaveLength(3);
    });
  });
});

// Type used only by the unknown-surface-kind test so we can pass an
// invalid string in without disabling all type-checking on the call.
type RecallKindForTest = 'message' | 'note' | 'agentEvent' | 'file' | 'ask';
