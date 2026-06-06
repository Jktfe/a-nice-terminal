/**
 * blockDigest — a cheap, extractive, reaction-weighted summariser over a slice
 * of room messages. ONE primitive, two consumers (per the blocks model):
 *   • focus exit-digest — what a shielded member missed, on release.
 *   • blocks "summarise block N" — on-demand catch-up of a past block.
 *
 * Design (JWPK 2026-06-05):
 *   • BREAK-BOUNDED: the caller passes only the messages of the target block
 *     (e.g. via listMessagesAfterLatestBreak) — this never reconstructs across
 *     a `system-break` (that's a hard boundary; the summary would otherwise
 *     backdoor it).
 *   • REACTION-WEIGHTED: a reacted-to message ranks higher, so catch-up surfaces
 *     what the room found important, not a flat dump.
 *   • CHEAP/EXTRACTIVE: pick the top-weighted messages and quote them — no
 *     model call per flush (a flood traded for a cost spike is no win).
 *
 * Skips system/break/deleted messages (the unified "is this visible?" filter).
 */

import type { ChatMessage } from './chatMessageStore';

export type BlockDigestInput = {
  /** The block's messages, oldest-first (caller scopes to one block). */
  messages: ChatMessage[];
  /** message_id → number of reactions, for weighting. Missing = 0. */
  reactionCountByMessageId?: Map<string, number>;
  /** Max messages to quote in the digest (default 8). */
  maxItems?: number;
  /** Max characters of body quoted per message (default 140). */
  maxBodyChars?: number;
};

export type BlockDigest = {
  /** Human-readable digest text (the thing injected to the returning member). */
  text: string;
  /** Total content messages considered (post visible-filter). */
  consideredCount: number;
  /** How many were quoted (the rest summarised as "+N more"). */
  quotedCount: number;
};

const DEFAULT_MAX_ITEMS = 8;
const DEFAULT_MAX_BODY_CHARS = 140;

/** A message carries digest-worthy content (not a marker, not deleted). */
function isDigestContent(message: ChatMessage): boolean {
  if (message.kind === 'system' || message.kind === 'system-break') return false;
  if (message.deletedAtMs) return false;
  return message.body.trim().length > 0;
}

function truncate(body: string, max: number): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/**
 * Build a reaction-weighted extractive digest of one block's messages. Pure —
 * no IO. Returns empty text when there's nothing to summarise.
 */
export function summariseBlock(input: BlockDigestInput): BlockDigest {
  const maxItems = input.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxBodyChars = input.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
  const reactions = input.reactionCountByMessageId ?? new Map<string, number>();

  // Keep original order for chronological output; index gives a stable
  // tie-breaker so selection + rendering are deterministic.
  const content = input.messages.filter(isDigestContent);
  if (content.length === 0) {
    return { text: '', consideredCount: 0, quotedCount: 0 };
  }

  const ranked = content
    .map((message, originalIndex) => ({
      message,
      originalIndex,
      // weight: reactions dominate; recency (later index) breaks ties so the
      // most recent of equally-reacted messages wins a scarce slot.
      weight: (reactions.get(message.id) ?? 0) * 1000 + originalIndex
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxItems)
    // re-sort the chosen few back into chronological order to read naturally.
    .sort((a, b) => a.originalIndex - b.originalIndex);

  const lines = ranked.map(({ message }) => {
    const reactionCount = reactions.get(message.id) ?? 0;
    const star = reactionCount > 0 ? ` (${reactionCount}⭐)` : '';
    return `• ${message.authorHandle}${star}: ${truncate(message.body, maxBodyChars)}`;
  });

  const omitted = content.length - ranked.length;
  const header = `📋 ${content.length} message${content.length === 1 ? '' : 's'} while you were away (most-reacted first):`;
  const footer = omitted > 0 ? `\n…+${omitted} more in this block.` : '';

  return {
    text: `${header}\n${lines.join('\n')}${footer}`,
    consideredCount: content.length,
    quotedCount: ranked.length
  };
}
