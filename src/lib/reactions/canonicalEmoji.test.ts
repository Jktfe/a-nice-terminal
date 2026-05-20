import { describe, expect, it } from 'vitest';
import {
  ALLOWED_REACTION_EMOJI,
  isAllowedReactionEmoji,
  REACTION_EMOJI_LABELS
} from './canonicalEmoji';

describe('canonicalEmoji', () => {
  it('has exactly 5 allowed emojis', () => {
    expect(ALLOWED_REACTION_EMOJI).toHaveLength(5);
  });

  it('allows canonical emojis', () => {
    expect(isAllowedReactionEmoji('👍')).toBe(true);
    expect(isAllowedReactionEmoji('👎')).toBe(true);
    expect(isAllowedReactionEmoji('👌')).toBe(true);
    expect(isAllowedReactionEmoji('🙌')).toBe(true);
    expect(isAllowedReactionEmoji('🙋‍♂️')).toBe(true);
  });

  it('rejects non-canonical emojis', () => {
    expect(isAllowedReactionEmoji('❤️')).toBe(false);
    expect(isAllowedReactionEmoji('🔥')).toBe(false);
    expect(isAllowedReactionEmoji('hello')).toBe(false);
    expect(isAllowedReactionEmoji('')).toBe(false);
  });

  it('labels each emoji', () => {
    expect(REACTION_EMOJI_LABELS['👍']).toBe('Good');
    expect(REACTION_EMOJI_LABELS['👎']).toBe('Bad');
    expect(REACTION_EMOJI_LABELS['👌']).toBe('OK');
    expect(REACTION_EMOJI_LABELS['🙌']).toBe('Celebrate');
    expect(REACTION_EMOJI_LABELS['🙋‍♂️']).toBe('Question');
  });
});
