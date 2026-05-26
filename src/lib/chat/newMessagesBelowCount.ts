/**
 * "N new messages below" counter (NMT feedback #B from @mark,
 * 2026-05-26, hs9jv51zrh msg_s5evnuysv6 via @newmodelteambot).
 *
 * Given the full ordered message list, the id of the last message the
 * viewer saw while at the bottom, and whether they're currently at the
 * bottom, returns how many new messages have arrived since they last
 * caught up.
 *
 * Tracking strategy (owned by MessageList.svelte): snapshot
 * `lastSeenMessageIdAtBottom` whenever `shouldFollowBottom` is true.
 * When the viewer scrolls up, the snapshot is frozen and this helper
 * counts messages after it. The snapshot re-captures on return-to-
 * bottom, naturally resetting the count.
 *
 * Pure function so the math (which is fiddly around edge cases like
 * "first mount", "snapshot id paged out of view", "viewer at bottom")
 * can be unit-tested without mounting the Svelte component.
 */

type MessageRef = { id: string };

export function countMessagesBelow(
  messages: ReadonlyArray<MessageRef>,
  lastSeenMessageIdAtBottom: string | null,
  shouldFollowBottom: boolean
): number {
  if (shouldFollowBottom) return 0;
  if (!lastSeenMessageIdAtBottom) return 0;
  if (messages.length === 0) return 0;
  const idx = messages.findIndex((m) => m.id === lastSeenMessageIdAtBottom);
  // Snapshot id paged out (e.g. older messages loaded; the last-seen
  // message id is now older than the start of the list, or the list
  // refreshed and the id no longer exists). Return 0 rather than over-
  // count — better to under-report than to scare the user with a wild
  // number on transient state.
  if (idx === -1) return 0;
  return Math.max(0, messages.length - 1 - idx);
}
