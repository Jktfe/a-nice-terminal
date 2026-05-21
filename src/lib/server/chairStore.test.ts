import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  postBreakMessage,
  postMessage,
  postSystemMessage,
  resetChatMessageStoreForTests
} from './chatMessageStore';
import {
  answerAsk,
  dismissAsk,
  openAskInRoom,
  resetAskStoreForTests
} from './askStore';
import {
  clearLLMSummaryForRoom,
  listChairDigest,
  resetChairStoreForTests,
  setLLMSummaryForRoom
} from './chairStore';

describe('chairStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetAskStoreForTests();
    resetChairStoreForTests();
  });

  it('returns one digest row per room', () => {
    createChatRoom({ name: 'one', whoCreatedIt: '@you' });
    createChatRoom({ name: 'two', whoCreatedIt: '@you' });
    const digest = listChairDigest();
    expect(digest).toHaveLength(2);
  });

  it('counts messages by kind', () => {
    // The store function inviteAgentToRoom only adds the member; the system
    // message is emitted by the endpoint. The chair digest counts whatever
    // is in chatMessageStore, so we post the system message directly here.
    const room = createChatRoom({ name: 'counts', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@bot' });
    postSystemMessage({ roomId: room.id, body: '@bot joined this room.' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'hi', kind: 'human' });
    postMessage({ roomId: room.id, authorHandle: '@bot', body: 'hey', kind: 'agent' });
    const [digest] = listChairDigest();
    expect(digest.messageCountHuman).toBe(1);
    expect(digest.messageCountAgent).toBe(1);
    expect(digest.messageCountSystem).toBeGreaterThanOrEqual(1);
  });

  it('records the last-message summary truncated to 80 chars', () => {
    const room = createChatRoom({ name: 'long-msg', whoCreatedIt: '@you' });
    const longMessageBody = 'x'.repeat(200);
    postMessage({ roomId: room.id, authorHandle: '@you', body: longMessageBody });
    const [digest] = listChairDigest();
    expect(digest.lastMessageSummary?.length).toBeLessThanOrEqual(81);
    expect(digest.lastMessageSummary?.endsWith('…')).toBe(true);
  });

  it('records the last break posted timestamp', () => {
    const room = createChatRoom({ name: 'with-break', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'before' });
    const breakMessage = postBreakMessage({ roomId: room.id, postedByHandle: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'after' });
    const [digest] = listChairDigest();
    expect(digest.lastBreakPostedAt).toBe(breakMessage.postedAt);
  });

  it('flags an empty room as needing attention', () => {
    createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
    const [digest] = listChairDigest();
    expect(digest.needsAttentionReason).toContain('empty');
  });

  it('flags a no-agent room as needing attention', () => {
    const room = createChatRoom({ name: 'no-agent', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'lonely' });
    const [digest] = listChairDigest();
    expect(digest.needsAttentionReason).toContain('agent');
  });

  it('does not flag a freshly answered room', () => {
    const room = createChatRoom({ name: 'fresh', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@bot' });
    postMessage({ roomId: room.id, authorHandle: '@bot', body: 'on it', kind: 'agent' });
    const [digest] = listChairDigest();
    expect(digest.needsAttentionReason).toBeNull();
  });

  // M29 asks-summary extension — openAsksCount per room.
  describe('openAsksCount', () => {
    it('is 0 for a room with no asks', () => {
      createChatRoom({ name: 'empty-asks', whoCreatedIt: '@you' });
      const [digest] = listChairDigest();
      expect(digest.openAsksCount).toBe(0);
    });

    it('equals the number of open asks in that room', () => {
      const room = createChatRoom({ name: 'three-asks', whoCreatedIt: '@you' });
      openAskInRoom({ roomId: room.id, openedByHandle: '@you', title: 'a', body: 'x' });
      openAskInRoom({ roomId: room.id, openedByHandle: '@you', title: 'b', body: 'x' });
      openAskInRoom({ roomId: room.id, openedByHandle: '@you', title: 'c', body: 'x' });
      const [digest] = listChairDigest();
      expect(digest.openAsksCount).toBe(3);
    });

    it('excludes answered and dismissed asks (listOpenAsksInRoom contract)', () => {
      const room = createChatRoom({ name: 'mixed-asks', whoCreatedIt: '@you' });
      openAskInRoom({ roomId: room.id, openedByHandle: '@you', title: 'open', body: 'x' });
      const toAnswer = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'answered',
        body: 'x'
      });
      const toDismiss = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'dismissed',
        body: 'x'
      });
      answerAsk({ askId: toAnswer.id, answeredByHandle: '@you', answer: 'r' });
      dismissAsk({ askId: toDismiss.id, dismissedByHandle: '@you' });
      const [digest] = listChairDigest();
      expect(digest.openAsksCount).toBe(1);
    });

    it('scopes per room (no cross-room leakage)', () => {
      const roomA = createChatRoom({ name: 'alpha', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'beta', whoCreatedIt: '@you' });
      openAskInRoom({ roomId: roomA.id, openedByHandle: '@you', title: 'a1', body: 'x' });
      openAskInRoom({ roomId: roomA.id, openedByHandle: '@you', title: 'a2', body: 'x' });
      openAskInRoom({ roomId: roomB.id, openedByHandle: '@you', title: 'b1', body: 'x' });
      const digestRows = listChairDigest();
      const alpha = digestRows.find((row) => row.roomName === 'alpha');
      const beta = digestRows.find((row) => row.roomName === 'beta');
      expect(alpha?.openAsksCount).toBe(2);
      expect(beta?.openAsksCount).toBe(1);
    });

    it('is always present on every row (additive field, never undefined)', () => {
      createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      createChatRoom({ name: 'two', whoCreatedIt: '@you' });
      const digest = listChairDigest();
      for (const row of digest) {
        expect(typeof row.openAsksCount).toBe('number');
        expect(row.openAsksCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('M29 slice 4a LLM writer hook seam', () => {
    it('setLLMSummaryForRoom populates digest.llmGeneratedSummary', () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      setLLMSummaryForRoom({ roomId: room.id, summary: 'Cheap-model digest' });
      const digest = listChairDigest();
      expect(digest[0].llmGeneratedSummary).toBe('Cheap-model digest');
    });

    it('clearLLMSummaryForRoom removes the llmGeneratedSummary field', () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      setLLMSummaryForRoom({ roomId: room.id, summary: 'first push' });
      clearLLMSummaryForRoom(room.id);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('rejects blank/whitespace summary without mutating the map', () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const before = listChairDigest();
      expect(Reflect.has(before[0], 'llmGeneratedSummary')).toBe(false);
      expect(() => setLLMSummaryForRoom({ roomId: room.id, summary: '   ' })).toThrow(
        /blank/i
      );
      const after = listChairDigest();
      expect(Reflect.has(after[0], 'llmGeneratedSummary')).toBe(false);
    });

    it('rejects unknown roomId BEFORE checking summary text; map unchanged', () => {
      const room = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      expect(() =>
        setLLMSummaryForRoom({ roomId: 'missing-id', summary: 'valid text' })
      ).toThrow(/No room found/);
      const digest = listChairDigest();
      expect(Reflect.has(digest[0], 'llmGeneratedSummary')).toBe(false);
      expect(digest.find((d) => d.roomId === room.id)).toBeDefined();
    });

    it('scopes summary per room and per clear', () => {
      const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
      setLLMSummaryForRoom({ roomId: roomA.id, summary: 'A summary' });
      setLLMSummaryForRoom({ roomId: roomB.id, summary: 'B summary' });
      let digest = listChairDigest();
      expect(digest.find((d) => d.roomId === roomA.id)?.llmGeneratedSummary).toBe('A summary');
      expect(digest.find((d) => d.roomId === roomB.id)?.llmGeneratedSummary).toBe('B summary');
      clearLLMSummaryForRoom(roomA.id);
      digest = listChairDigest();
      expect(Reflect.has(digest.find((d) => d.roomId === roomA.id)!, 'llmGeneratedSummary')).toBe(false);
      expect(digest.find((d) => d.roomId === roomB.id)?.llmGeneratedSummary).toBe('B summary');
    });

    it('omits llmGeneratedSummary entirely when no summary stored (zero-drift)', () => {
      createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      createChatRoom({ name: 'two', whoCreatedIt: '@you' });
      const digest = listChairDigest();
      for (const row of digest) {
        expect(Reflect.has(row, 'llmGeneratedSummary')).toBe(false);
      }
    });

    it('resetChairStoreForTests clears the entire map', () => {
      const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
      const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
      setLLMSummaryForRoom({ roomId: roomA.id, summary: 'A summary' });
      setLLMSummaryForRoom({ roomId: roomB.id, summary: 'B summary' });
      resetChairStoreForTests();
      const digest = listChairDigest();
      for (const row of digest) {
        expect(Reflect.has(row, 'llmGeneratedSummary')).toBe(false);
      }
    });
  });
});
