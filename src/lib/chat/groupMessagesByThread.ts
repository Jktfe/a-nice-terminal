/*
  groupMessagesByThread — pure helper that reorders a ChatMessage[] for
  threaded display. A reply is pulled forward to sit directly after its
  DIRECT parent when, AND ONLY WHEN, no system or system-break row sits
  between parent and child in postOrder. System rows act as chronological
  barriers: a reply that would have to cross a system or system-break to
  reach its parent stays in its ORIGINAL chronological slot. Nested
  replies follow the same rule per hop (no depth-aware re-grouping).
  Orphan replies (parent missing from the input list) stay in their
  chronological slot. Cycles are handled by a failsafe trailing pass that
  emits any remaining unplaced messages, so the no-drop invariant always
  holds: output.length === input.length and output is a permutation.

  M30 slice 3d: pure UI render-time reorder. Input is the load-data
  messages[] in postOrder; storage/API order is untouched.
*/

import type { ChatMessage } from '$lib/server/chatMessageStore';

export function groupMessagesByThread(messages: ChatMessage[]): ChatMessage[] {
  const idSet = new Set(messages.map((m) => m.id));
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const childrenOf = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const parentId = m.parentMessageId;
    if (!parentId || !idSet.has(parentId)) continue;
    const parent = messageById.get(parentId);
    if (!parent || hasSystemBarrierBetween(parent, m, messages)) continue;
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(m);
    childrenOf.set(parentId, siblings);
  }
  const pullableIds = new Set<string>();
  for (const siblingList of childrenOf.values()) {
    for (const child of siblingList) pullableIds.add(child.id);
  }

  const output: ChatMessage[] = [];
  const placed = new Set<string>();

  function emit(message: ChatMessage): void {
    if (placed.has(message.id)) return;
    placed.add(message.id);
    output.push(message);
    const directChildren = childrenOf.get(message.id) ?? [];
    for (const child of directChildren) emit(child);
  }

  for (const message of messages) {
    if (placed.has(message.id)) continue;
    if (!pullableIds.has(message.id)) emit(message);
  }
  for (const message of messages) {
    if (!placed.has(message.id)) emit(message);
  }
  return output;
}

function hasSystemBarrierBetween(
  parent: ChatMessage,
  child: ChatMessage,
  messages: ChatMessage[]
): boolean {
  for (const m of messages) {
    if (m.postOrder <= parent.postOrder) continue;
    if (m.postOrder >= child.postOrder) continue;
    if (m.kind === 'system' || m.kind === 'system-break') return true;
  }
  return false;
}
