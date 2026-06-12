import { describe, expect, it } from 'vitest';

import {
  ALLOWED_REACTION_EMOJI,
  REACTION_EMOJI_LABELS,
  isAllowedReactionEmoji
} from './canonicalEmoji';

describe('canonical reaction emoji', () => {
  it('has exactly 6 allowed emojis', () => {
    expect(ALLOWED_REACTION_EMOJI).toHaveLength(6);
  });

  it('allows canonical emojis', () => {
    expect(isAllowedReactionEmoji('👍')).toBe(true);
    expect(isAllowedReactionEmoji('👎')).toBe(true);
    expect(isAllowedReactionEmoji('👌')).toBe(true);
    expect(isAllowedReactionEmoji('🙌')).toBe(true);
    expect(isAllowedReactionEmoji('🙋‍♂️')).toBe(true);
    expect(isAllowedReactionEmoji('🧏‍♂️')).toBe(true);
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
    expect(REACTION_EMOJI_LABELS['🧏‍♂️']).toBe('Heard / read');
  });

  it('includes the heard/read emoji as the low-noise acknowledgement signal', () => {
    expect(ALLOWED_REACTION_EMOJI).toContain('🧏‍♂️');
    expect(isAllowedReactionEmoji('🧏‍♂️')).toBe(true);
    expect(REACTION_EMOJI_LABELS['🧏‍♂️']).toBe('Heard / read');
  });
});
