/**
 * Shared between server (allowlist enforcement) and client (picker rendering).
 * Lives outside $lib/server so the client can import it without dragging
 * server-only modules into the bundle.
 *
 * Per JWPK 2026-05-13 EMOJI-TRIM: reactions are constrained to this 5-way
 * spectrum, labelled Bad / OK / Good / Celebrate / Question in the picker.
 */

export const ALLOWED_REACTION_EMOJI = ['👎', '👌', '👍', '🙌', '🙋‍♂️'] as const;
export type AllowedReactionEmoji = (typeof ALLOWED_REACTION_EMOJI)[number];

const ALLOWED_REACTION_EMOJI_SET = new Set<string>(ALLOWED_REACTION_EMOJI);

export function isAllowedReactionEmoji(candidate: string): candidate is AllowedReactionEmoji {
  return ALLOWED_REACTION_EMOJI_SET.has(candidate);
}

export const REACTION_EMOJI_LABELS: Record<AllowedReactionEmoji, string> = {
  '👎': 'Bad',
  '👌': 'OK',
  '👍': 'Good',
  '🙌': 'Celebrate',
  '🙋‍♂️': 'Question'
};
