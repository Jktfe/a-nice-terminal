/**
 * blockSummariser — prepares a block's content for summarisation, weighted by
 * user reactions.
 *
 * "Summaries can take into account user reactions for weights" (JWPK). A
 * message everyone 👍'd is higher-signal than one nobody reacted to. This
 * primitive does the DETERMINISTIC part: read the block (research-clean — no
 * deleted messages/blocks), attach each message's reaction weight, and surface
 * the highlights (highest-weight messages). The actual natural-language summary
 * is an agent/LLM step on top; this gives it ranked, de-noised material instead
 * of a flat transcript.
 *
 * Weight = 1 (the message exists) + total reaction count on it. A neutral,
 * extensible base: swap in emoji-sentiment or distinct-reactor weighting later
 * without changing callers.
 *
 * See docs/concepts/ant-room-blocks.md (facet 6).
 */

import { readBlock, type BlockSummary } from './roomBlocksStore';
import { summariseReactionsForMessage, type MessageReactionSummary } from './messageReactionStore';

export type WeightedMessage = {
  id: string;
  authorHandle: string;
  body: string;
  postedAt: string;
  /** 1 + total reaction count. Higher = more endorsed by the room. */
  weight: number;
  reactions: MessageReactionSummary[];
};

export type BlockSummaryInput = {
  block: BlockSummary;
  messageCount: number;
  /** Distinct author handles in the block, in first-seen order. */
  participants: string[];
  totalReactions: number;
  /** Every (non-deleted) message in order, with its weight. */
  weightedMessages: WeightedMessage[];
  /** The highest-weight messages (desc), capped — the "what mattered" shortlist. */
  highlights: WeightedMessage[];
};

function totalReactionCount(reactions: MessageReactionSummary[]): number {
  return reactions.reduce((sum, r) => sum + r.count, 0);
}

/**
 * Build the reaction-weighted summary input for a block. Returns null if the
 * block id is unknown. A deleted block (skipped in the research-clean read)
 * yields an empty input — nothing to summarise — which is the point.
 */
export function buildBlockSummaryInput(
  roomId: string,
  blockId: string,
  options: { highlightLimit?: number } = {}
): BlockSummaryInput | null {
  const read = readBlock(roomId, blockId);
  if (!read) return null;

  const highlightLimit = options.highlightLimit ?? 5;
  const participants: string[] = [];
  const seen = new Set<string>();
  let totalReactions = 0;

  const weightedMessages: WeightedMessage[] = read.messages.map((m) => {
    const reactions = summariseReactionsForMessage(m.id);
    const reactionCount = totalReactionCount(reactions);
    totalReactions += reactionCount;
    if (!seen.has(m.authorHandle)) {
      seen.add(m.authorHandle);
      participants.push(m.authorHandle);
    }
    return {
      id: m.id,
      authorHandle: m.authorHandle,
      body: m.body,
      postedAt: m.postedAt,
      weight: 1 + reactionCount,
      reactions
    };
  });

  // Highlights: highest weight first; ties keep chronological order (stable
  // sort on a copy). Only messages that actually drew a reaction qualify —
  // an unreacted block has no highlights, not an arbitrary top-N.
  const highlights = weightedMessages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.weight > 1)
    .sort((a, b) => b.m.weight - a.m.weight || a.i - b.i)
    .slice(0, highlightLimit)
    .map(({ m }) => m);

  return {
    block: read.block,
    messageCount: weightedMessages.length,
    participants,
    totalReactions,
    weightedMessages,
    highlights
  };
}
