/**
 * Emoji reactions on chat messages.
 *
 * Backs M17 reactions slice 1 (backend). One reactor can react to a message
 * with many emojis; for any (messageId, reactorHandle, emoji) triple the
 * reaction is unique. A second addReaction for the same triple keeps the
 * original reactedAt time — first-react wins.
 *
 * Public functions:
 *   - addReactionToMessage         record one reaction (idempotent per triple)
 *   - removeReactionFromMessage    drop one reaction (returns whether it existed)
 *   - listReactionsForMessage      every reaction on a message, reaction-order
 *   - resetMessageReactionStoreForTests
 *
 * No chat-message integration here — the store accepts opaque message ids
 * and trusts the caller (the endpoint) to verify the message exists. Same
 * boundary discipline as read receipts.
 *
 * Persistence: SQLite-backed via getIdentityDb (JWPK msg_71divtsj8r
 * ratified ask_r0v3b4t — reactions survive launchd kickstart). Schema
 * lives in db.ts (message_reactions table; PRIMARY KEY on the
 * messageId/handle/emoji triple enforces first-react-wins via INSERT OR
 * IGNORE rather than read-then-write).
 */

import { ALLOWED_REACTION_EMOJI, isAllowedReactionEmoji } from '$lib/reactions/canonicalEmoji';
import { getIdentityDb } from './db';

const HARD_CAP_EMOJI_LENGTH = 32; // generous: covers ZWJ sequences + skin tone

export type MessageReaction = {
  messageId: string;
  reactorHandle: string;
  emoji: string;
  reactedAt: string;
};

export type MessageReactionSummary = {
  emoji: string;
  count: number;
  topReactors: string[];
  /**
   * True when `viewerHandle` (passed to `summariseReactionsForMessage`) has
   * a reaction recorded for this emoji on this message. Always present;
   * defaults to `false` when no viewer handle is supplied (e.g. legacy
   * call-sites or admin-bearer reads).
   *
   * Why: `topReactors` is truncated at 5; clients that infer viewer-reacted
   * from that list miss the case where the viewer reacted but isn't in the
   * top-N. M1 reactions UX needs reliable toggle semantics — homebrew flag
   * 2026-05-27 msg_znoxuoppy8.
   */
  viewerHasReacted: boolean;
};

type ReactionRow = {
  message_id: string;
  reactor_handle: string;
  emoji: string;
  reacted_at: string;
};

function rowToReaction(row: ReactionRow): MessageReaction {
  return {
    messageId: row.message_id,
    reactorHandle: row.reactor_handle,
    emoji: row.emoji,
    reactedAt: row.reacted_at
  };
}

export function addReactionToMessage(input: {
  messageId: string;
  reactorHandle: string;
  emoji: string;
}): MessageReaction {
  const trimmedMessageId = input.messageId.trim();
  if (trimmedMessageId.length === 0) {
    throw new Error('A messageId is required to add a reaction.');
  }
  const trimmedHandle = input.reactorHandle.trim();
  if (trimmedHandle.length === 0) {
    throw new Error('A reactorHandle is required to add a reaction.');
  }
  const trimmedEmoji = input.emoji.trim();
  if (trimmedEmoji.length === 0) {
    throw new Error('An emoji is required to add a reaction.');
  }
  if (trimmedEmoji.length > HARD_CAP_EMOJI_LENGTH) {
    throw new Error(`emoji is longer than ${HARD_CAP_EMOJI_LENGTH} characters.`);
  }
  if (!isAllowedReactionEmoji(trimmedEmoji)) {
    throw new Error(
      `emoji must be one of: ${ALLOWED_REACTION_EMOJI.join(' ')}`
    );
  }

  const db = getIdentityDb();
  const reactedAt = new Date().toISOString();
  // INSERT OR IGNORE preserves the first-react-wins semantics of the prior
  // in-memory store: a duplicate triple keeps the original reactedAt time
  // because the existing row's reacted_at column stays untouched.
  db.prepare(
    `INSERT OR IGNORE INTO message_reactions
       (message_id, reactor_handle, emoji, reacted_at)
     VALUES (?, ?, ?, ?)`
  ).run(trimmedMessageId, trimmedHandle, trimmedEmoji, reactedAt);

  const stored = db
    .prepare(
      `SELECT * FROM message_reactions
       WHERE message_id = ? AND reactor_handle = ? AND emoji = ?`
    )
    .get(trimmedMessageId, trimmedHandle, trimmedEmoji) as ReactionRow | undefined;
  if (!stored) {
    // Shouldn't happen — INSERT OR IGNORE either inserted or matched an
    // existing row. Fall back to a synthetic value so callers don't see
    // null in the happy path.
    return {
      messageId: trimmedMessageId,
      reactorHandle: trimmedHandle,
      emoji: trimmedEmoji,
      reactedAt
    };
  }
  return rowToReaction(stored);
}

export function removeReactionFromMessage(input: {
  messageId: string;
  reactorHandle: string;
  emoji: string;
}): boolean {
  const trimmedMessageId = input.messageId.trim();
  const trimmedHandle = input.reactorHandle.trim();
  const trimmedEmoji = input.emoji.trim();
  if (trimmedMessageId.length === 0 || trimmedHandle.length === 0 || trimmedEmoji.length === 0) {
    return false;
  }
  const db = getIdentityDb();
  const info = db
    .prepare(
      `DELETE FROM message_reactions
       WHERE message_id = ? AND reactor_handle = ? AND emoji = ?`
    )
    .run(trimmedMessageId, trimmedHandle, trimmedEmoji);
  return info.changes > 0;
}

export function listReactionsForMessage(messageId: string): MessageReaction[] {
  const db = getIdentityDb();
  // ORDER BY rowid preserves insert order — same as the prior in-memory
  // array push order, so first-react-first-listed survives. reacted_at
  // alone would tie when reactions arrive in the same millisecond and
  // collapse the contract to alphabetical-by-handle (test M17 caught
  // this on the SQLite cutover).
  const rows = db
    .prepare(
      `SELECT * FROM message_reactions
       WHERE message_id = ?
       ORDER BY rowid ASC`
    )
    .all(messageId) as ReactionRow[];
  return rows.map(rowToReaction);
}

export function summariseReactionsForMessage(
  messageId: string,
  viewerHandles?: readonly string[]
): MessageReactionSummary[] {
  // A single viewer can have multiple aliases (family handles) — e.g. one
  // user might react as `@jamesK` or `@you` interchangeably. The endpoint
  // passes the full resolved handle family from `requireChatRoomReadAccess`,
  // and we mark viewerHasReacted true if any reaction is by any of them.
  const viewerHandleSet =
    viewerHandles && viewerHandles.length > 0 ? new Set(viewerHandles) : null;
  const summariesByEmoji = new Map<string, MessageReactionSummary>();
  for (const reaction of listReactionsForMessage(messageId)) {
    const isViewerReaction = viewerHandleSet !== null && viewerHandleSet.has(reaction.reactorHandle);
    const summary = summariesByEmoji.get(reaction.emoji);
    if (summary) {
      summary.count += 1;
      if (summary.topReactors.length < 5) summary.topReactors.push(reaction.reactorHandle);
      if (isViewerReaction) summary.viewerHasReacted = true;
      continue;
    }
    summariesByEmoji.set(reaction.emoji, {
      emoji: reaction.emoji,
      count: 1,
      topReactors: [reaction.reactorHandle],
      viewerHasReacted: isViewerReaction
    });
  }
  return [...summariesByEmoji.values()];
}

export function resetMessageReactionStoreForTests(): void {
  // Test helper: wipe every reaction. Tests that target reaction projection
  // call this at setup so the SQLite-backed store starts clean — matches
  // the prior in-memory Map.clear() behaviour.
  const db = getIdentityDb();
  db.prepare(`DELETE FROM message_reactions`).run();
}
