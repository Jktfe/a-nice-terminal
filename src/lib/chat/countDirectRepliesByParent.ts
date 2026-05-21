/*
  countDirectRepliesByParent — pure helper that counts how many direct
  replies each message has within the input list. Single linear walk.
  Output is a Map keyed by parent message id, value = number of messages
  that point at that parent via parentMessageId.

  Direct children only — no recursive descendant flattening. Matches the
  M30 slice 3d direct-children-only contract.

  Orphan replies (whose parent is not present in the input list) still
  contribute an entry under their missing-parent key; consumers that
  iterate visible rows simply never see that key, so an orphan never
  produces a visible badge. system + system-break never carry
  parentMessageId (M30 slice 2 endpoint guardrail) so they never
  increment any counter.

  M30 slice 3e: used by MessageList to derive per-parent reply counts
  passed down to MessageRow for the "↳ N" badge.
*/

import type { ChatMessage } from '$lib/server/chatMessageStore';

export function countDirectRepliesByParent(messages: ChatMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const parentId = m.parentMessageId;
    if (!parentId) continue;
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
  }
  return counts;
}
