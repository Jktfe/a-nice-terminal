import { beforeEach, describe, expect, it } from 'vitest';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from './chatMessageStore';
import { resetAskStoreForTests } from './askStore';
import {
  backfillAskCandidatesFromRecentMessages,
  collectAskCandidateFromReaction,
  collectAskCandidatesFromMessage,
  dismissAskCandidate,
  listOpenAskCandidates,
  promoteAskCandidate
} from './askCandidateStore';
import { getIdentityDb } from './db';

describe('askCandidateStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetAskStoreForTests();
  });

  it('creates a candidate for bare @you mentions but not bracketed references', () => {
    const room = createChatRoom({ name: 'candidate-room', whoCreatedIt: '@you' });
    const bracketed = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: 'FYI [@you] is in the room'
    });
    expect(collectAskCandidatesFromMessage(bracketed)).toEqual([]);

    const bare = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: '@you should this be a surfaced ask?'
    });
    const candidates = collectAskCandidatesFromMessage(bare);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      roomId: room.id,
      sourceMessageId: bare.id,
      sourceType: 'mention',
      sourceActorHandle: '@codex',
      status: 'candidate'
    });
  });

  it('creates a candidate for standalone @ shorthand to the logged-in human', () => {
    const room = createChatRoom({ name: 'candidate-room', whoCreatedIt: '@you' });
    const shorthand = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: '@ can you decide this?'
    });

    const candidates = collectAskCandidatesFromMessage(shorthand);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      roomId: room.id,
      sourceMessageId: shorthand.id,
      sourceType: 'mention',
      sourceActorHandle: '@codex',
      status: 'candidate'
    });
  });

  it('does not create a candidate for standalone @ inside quotes', () => {
    const room = createChatRoom({ name: 'candidate-room', whoCreatedIt: '@you' });
    const quoted = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: '"@" is just a quoted symbol'
    });

    expect(collectAskCandidatesFromMessage(quoted)).toEqual([]);
  });

  it('creates message-emoji and reaction candidates idempotently', () => {
    const room = createChatRoom({ name: 'emoji-room', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'I am raising this 🙋‍♂️'
    });

    expect(collectAskCandidatesFromMessage(message)).toHaveLength(1);
    expect(collectAskCandidatesFromMessage(message)).toHaveLength(0);

    const plain = postMessage({
      roomId: room.id,
      authorHandle: '@svelte',
      body: 'needs a reaction signal'
    });
    expect(
      collectAskCandidateFromReaction({
        roomId: room.id,
        message: plain,
        reactorHandle: '@you',
        emoji: '🙌'
      })
    ).toMatchObject({
      sourceType: 'reaction',
      sourceEmoji: '🙌'
    });
    expect(
      collectAskCandidateFromReaction({
        roomId: room.id,
        message: plain,
        reactorHandle: '@you',
        emoji: '🙌'
      })
    ).toBeNull();

    expect(listOpenAskCandidates(room.id).map((candidate) => candidate.sourceType)).toEqual([
      'emoji-message',
      'reaction'
    ]);
  });

  it('retro-scans recent messages and ignores older messages', () => {
    const room = createChatRoom({ name: 'retro-room', whoCreatedIt: '@you' });
    const old = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: '@you this is too old'
    });
    getIdentityDb()
      .prepare(`UPDATE chat_messages SET posted_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), old.id);
    postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: '@you this should be backfilled'
    });

    expect(backfillAskCandidatesFromRecentMessages()).toBe(1);
    const candidates = listOpenAskCandidates(room.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].body).toContain('this should be backfilled');
  });

  it('promotes and dismisses candidates without mutating explicit asks prematurely', () => {
    const room = createChatRoom({ name: 'promote-room', whoCreatedIt: '@you' });
    const first = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: '@you promote this'
    });
    const second = postMessage({
      roomId: room.id,
      authorHandle: '@codex',
      body: '@you dismiss this'
    });
    const [promotable] = collectAskCandidatesFromMessage(first);
    const [dismissible] = collectAskCandidatesFromMessage(second);

    const promoted = promoteAskCandidate({
      candidateId: promotable.id,
      promotedByHandle: '@you'
    });
    expect(promoted.ask.status).toBe('open');
    expect(promoted.candidate.status).toBe('promoted');
    expect(promoted.candidate.promotedAskId).toBe(promoted.ask.id);

    const dismissed = dismissAskCandidate({
      candidateId: dismissible.id,
      dismissedByHandle: '@you'
    });
    expect(dismissed.status).toBe('dismissed');
    expect(listOpenAskCandidates(room.id)).toEqual([]);
  });
});
