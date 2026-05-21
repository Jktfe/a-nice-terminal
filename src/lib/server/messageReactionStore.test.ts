import { beforeEach, describe, expect, it } from 'vitest';
import {
  addReactionToMessage,
  listReactionsForMessage,
  removeReactionFromMessage,
  resetMessageReactionStoreForTests
} from './messageReactionStore';

describe('messageReactionStore', () => {
  beforeEach(() => {
    resetMessageReactionStoreForTests();
  });

  it('addReactionToMessage records a reaction', () => {
    const reaction = addReactionToMessage({
      messageId: 'msg_1',
      reactorHandle: '@you',
      emoji: '👍'
    });
    expect(reaction.messageId).toBe('msg_1');
    expect(reaction.reactorHandle).toBe('@you');
    expect(reaction.emoji).toBe('👍');
    expect(reaction.reactedAt.length).toBeGreaterThan(0);
  });

  it('is idempotent for the same (messageId, reactor, emoji) triple', () => {
    const first = addReactionToMessage({
      messageId: 'msg_1',
      reactorHandle: '@you',
      emoji: '👍'
    });
    const second = addReactionToMessage({
      messageId: 'msg_1',
      reactorHandle: '@you',
      emoji: '👍'
    });
    expect(second.reactedAt).toBe(first.reactedAt);
    expect(listReactionsForMessage('msg_1')).toHaveLength(1);
  });

  it('allows the same reactor to use different emojis on the same message', () => {
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '👍' });
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '🙌' });
    expect(listReactionsForMessage('msg_1')).toHaveLength(2);
  });

  it('allows different reactors to use the same emoji on the same message', () => {
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@one', emoji: '👍' });
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@two', emoji: '👍' });
    expect(listReactionsForMessage('msg_1')).toHaveLength(2);
  });

  it('trims surrounding whitespace on each field', () => {
    const reaction = addReactionToMessage({
      messageId: '  msg_1  ',
      reactorHandle: '  @you  ',
      emoji: '  👍  '
    });
    expect(reaction.messageId).toBe('msg_1');
    expect(reaction.reactorHandle).toBe('@you');
    expect(reaction.emoji).toBe('👍');
  });

  it('rejects a blank messageId', () => {
    expect(() =>
      addReactionToMessage({ messageId: '   ', reactorHandle: '@you', emoji: '👍' })
    ).toThrow();
  });

  it('rejects a blank reactorHandle', () => {
    expect(() =>
      addReactionToMessage({ messageId: 'msg_1', reactorHandle: '   ', emoji: '👍' })
    ).toThrow();
  });

  it('rejects a blank emoji', () => {
    expect(() =>
      addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '   ' })
    ).toThrow();
  });

  it('rejects an emoji outside the JWPK-canonical allowlist', () => {
    expect(() =>
      addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '🎉' })
    ).toThrow(/emoji must be one of/);
    expect(() =>
      addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '❤️' })
    ).toThrow(/emoji must be one of/);
    expect(() =>
      addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '🚀' })
    ).toThrow(/emoji must be one of/);
  });

  it('accepts every emoji in the JWPK-canonical allowlist', () => {
    for (const allowed of ['👎', '👌', '👍', '🙌', '🙋‍♂️']) {
      addReactionToMessage({ messageId: 'msg_a', reactorHandle: `@${allowed}`, emoji: allowed });
    }
    expect(listReactionsForMessage('msg_a')).toHaveLength(5);
  });

  it('rejects an emoji longer than the cap', () => {
    expect(() =>
      addReactionToMessage({
        messageId: 'msg_1',
        reactorHandle: '@you',
        emoji: 'a'.repeat(64)
      })
    ).toThrow();
  });

  it('removeReactionFromMessage returns true when the reaction existed', () => {
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '👍' });
    expect(
      removeReactionFromMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '👍' })
    ).toBe(true);
    expect(listReactionsForMessage('msg_1')).toEqual([]);
  });

  it('removeReactionFromMessage returns false when nothing was there', () => {
    expect(
      removeReactionFromMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '👍' })
    ).toBe(false);
  });

  it('removeReactionFromMessage only drops the matching emoji, leaving others', () => {
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '👍' });
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '🙌' });
    removeReactionFromMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '👍' });
    const remaining = listReactionsForMessage('msg_1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].emoji).toBe('🙌');
  });

  it('listReactionsForMessage returns reactions in add-order', () => {
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@one', emoji: '👍' });
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@two', emoji: '🙌' });
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@three', emoji: '👌' });
    expect(
      listReactionsForMessage('msg_1').map((entry) => entry.reactorHandle)
    ).toEqual(['@one', '@two', '@three']);
  });

  it('listReactionsForMessage returns a defensive copy', () => {
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '👍' });
    const list = listReactionsForMessage('msg_1');
    list.pop();
    expect(listReactionsForMessage('msg_1')).toHaveLength(1);
  });

  it('listReactionsForMessage returns an empty array for an unknown message', () => {
    expect(listReactionsForMessage('not_a_real_message')).toEqual([]);
  });

  it('keeps reactions per-message independent', () => {
    addReactionToMessage({ messageId: 'msg_a', reactorHandle: '@you', emoji: '👍' });
    addReactionToMessage({ messageId: 'msg_b', reactorHandle: '@you', emoji: '👍' });
    expect(listReactionsForMessage('msg_a')).toHaveLength(1);
    expect(listReactionsForMessage('msg_b')).toHaveLength(1);
  });

  it('resetMessageReactionStoreForTests clears every reaction', () => {
    addReactionToMessage({ messageId: 'msg_1', reactorHandle: '@you', emoji: '👍' });
    resetMessageReactionStoreForTests();
    expect(listReactionsForMessage('msg_1')).toEqual([]);
  });
});
