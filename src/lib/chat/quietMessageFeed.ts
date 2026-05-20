/*
  quietMessageFeed — append/merge messages for the room page without
  replacing the whole SSR-loaded list after a post.
*/

import type { ChatMessage } from '$lib/server/chatMessageStore';

export function mergeQuietMessageFeed(
  currentMessages: ChatMessage[],
  incomingMessages: ChatMessage[]
): ChatMessage[] {
  const byId = new Map(currentMessages.map((message) => [message.id, message]));
  for (const incoming of incomingMessages) {
    const current = byId.get(incoming.id);
    byId.set(incoming.id, current && messagesMatch(current, incoming) ? current : incoming);
  }
  return [...byId.values()].sort((a, b) => a.postOrder - b.postOrder);
}

function messagesMatch(left: ChatMessage, right: ChatMessage): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
