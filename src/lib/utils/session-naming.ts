export const LINKED_CHAT_SUFFIX = '-Chat';

export function normalizeSessionName(name: string) {
  return name.trim();
}

export function buildLinkedChatName(terminalName: string) {
  return `${normalizeSessionName(terminalName)}${LINKED_CHAT_SUFFIX}`;
}
