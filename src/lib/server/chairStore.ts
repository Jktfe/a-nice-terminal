/**
 * Chair digest store — the read-only view that powers M29 session-tracking.
 *
 * The chair is the always-on cheap-model agent that watches every room and
 * surfaces one-line digests plus needs-attention flags. Slice 1 (this file)
 * uses HEURISTIC digests built from the existing chatRoomStore and
 * chatMessageStore — no LLM call yet. Slice 2 swaps to a real cheap-model
 * digest once we have an LLM client primitive in the repo.
 *
 * Pure read functions over the other stores. No writes. Safe to call from
 * the GET endpoint without changing room or message state.
 *
 * Contract boundary worth remembering for tests and reviewers:
 * inviteAgentToRoom in chatRoomStore only adds the member; the system
 * message ("@x joined this room") is emitted by the /members endpoint, not
 * by the store. The chair counts whatever is in chatMessageStore at the
 * moment of the call, so test setups that bypass the endpoint must call
 * postSystemMessage explicitly to recreate the same shape.
 */

import { findChatRoomById, listChatRooms } from './chatRoomStore';
import { listMessagesInRoom } from './chatMessageStore';
import { listOpenAsksInRoom } from './askStore';
import type { ChatRoom } from './chatRoomStore';
import type { ChatMessage } from './chatMessageStore';

export type ChairRowDigest = {
  roomId: string;
  roomName: string;
  memberCount: number;
  messageCountTotal: number;
  messageCountHuman: number;
  messageCountAgent: number;
  messageCountSystem: number;
  lastMessagePostedAt: string | null;
  lastMessageSummary: string | null;
  lastBreakPostedAt: string | null;
  needsAttentionReason: string | null;
  // M29 asks-summary extension: per-room count of open asks (answered
  // and dismissed are excluded by listOpenAsksInRoom). Always present,
  // zero default — never undefined.
  openAsksCount: number;
  // #77 Chair-mediated asks UI: surface up to 3 most-recent open asks
  // per room directly on the digest so the operator can act without a
  // round-trip to /asks. Always present, empty array when none.
  recentOpenAsks: { id: string; title: string; openedByDisplayName: string; openedAt: string }[];
  // M29 slice 4a LLM writer hook seam: optional cheap-model summary
  // pushed in via setLLMSummaryForRoom. Conditional-spread in
  // buildDigestForRoom — when no entry exists for a room, the key is
  // OMITTED entirely (not undefined), so rooms without a summary keep
  // byte-identical digest shape with the pre-slice-4a baseline.
  llmGeneratedSummary?: string;
};

// M29 slice 4a: module-level Map mirrors the asksByRoomId precedent in
// askStore + aliasesByRoomId in chatRoomAliasStore + messagesByRoomId in
// chatMessageStore. In-memory only; persistence deferred per v3
// platform-completeness convention. resetChairStoreForTests clears
// this map (mirrors resetAskStoreForTests).
const llmSummaryByRoomId = new Map<string, string>();

export function listChairDigest(): ChairRowDigest[] {
  return listChatRooms().map((room) => buildDigestForRoom(room));
}

// M29 slice 4a writer hook — seam only. No LLM call, no scheduler, no
// caller in this slice. Membership-before-validation: unknown room
// throws BEFORE we touch the summary text, so a malformed payload on a
// missing room never pollutes the map.
export function setLLMSummaryForRoom(input: { roomId: string; summary: string }): void {
  if (!findChatRoomById(input.roomId)) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }
  const trimmed = input.summary.trim();
  if (trimmed.length === 0) {
    throw new Error('LLM summary must not be blank.');
  }
  llmSummaryByRoomId.set(input.roomId, trimmed);
}

export function clearLLMSummaryForRoom(roomId: string): void {
  llmSummaryByRoomId.delete(roomId);
}

export function resetChairStoreForTests(): void {
  llmSummaryByRoomId.clear();
}

function buildDigestForRoom(room: ChatRoom): ChairRowDigest {
  const messages = listMessagesInRoom(room.id);
  const counts = countMessagesByKind(messages);
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastBreak = findLastBreak(messages);
  const storedSummary = llmSummaryByRoomId.get(room.id);
  const openAsks = listOpenAsksInRoom(room.id);
  const recentOpenAsks = openAsks
    .slice()
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
    .slice(0, 3)
    .map((ask) => ({
      id: ask.id,
      title: ask.title,
      openedByDisplayName: ask.openedByDisplayName,
      openedAt: ask.openedAt
    }));

  return {
    roomId: room.id,
    roomName: room.name,
    memberCount: room.members.length,
    messageCountTotal: messages.length,
    messageCountHuman: counts.human,
    messageCountAgent: counts.agent,
    messageCountSystem: counts.system,
    lastMessagePostedAt: lastMessage?.postedAt ?? null,
    lastMessageSummary: lastMessage ? summariseMessage(lastMessage) : null,
    lastBreakPostedAt: lastBreak?.postedAt ?? null,
    needsAttentionReason: describeAttentionReason(room, messages, lastMessage),
    openAsksCount: openAsks.length,
    recentOpenAsks,
    ...(storedSummary !== undefined && { llmGeneratedSummary: storedSummary })
  };
}

function countMessagesByKind(messages: ChatMessage[]): {
  human: number;
  agent: number;
  system: number;
} {
  let humanCount = 0;
  let agentCount = 0;
  let systemCount = 0;
  for (const message of messages) {
    if (message.kind === 'human') humanCount = humanCount + 1;
    else if (message.kind === 'agent') agentCount = agentCount + 1;
    else systemCount = systemCount + 1;
  }
  return { human: humanCount, agent: agentCount, system: systemCount };
}

function findLastBreak(messages: ChatMessage[]): ChatMessage | null {
  for (let scanIndex = messages.length - 1; scanIndex >= 0; scanIndex--) {
    if (messages[scanIndex].kind === 'system-break') return messages[scanIndex];
  }
  return null;
}

function summariseMessage(message: ChatMessage): string {
  const maxCharsForSummary = 80;
  const cleanedBody = message.body.replace(/\s+/g, ' ').trim();
  if (cleanedBody.length <= maxCharsForSummary) return cleanedBody;
  return `${cleanedBody.slice(0, maxCharsForSummary)}…`;
}

const TWO_MINUTES_IN_MILLISECONDS = 2 * 60 * 1000;

function describeAttentionReason(
  room: ChatRoom,
  messages: ChatMessage[],
  lastMessage: ChatMessage | null
): string | null {
  if (messages.length === 0) {
    return 'Room is empty — invite an agent or post the first message.';
  }
  if (lastMessage && lastMessage.kind === 'human') {
    const postedAtAge = Date.now() - new Date(lastMessage.postedAt).getTime();
    if (postedAtAge > TWO_MINUTES_IN_MILLISECONDS) {
      return 'Human posted; no agent reply yet after 2 minutes.';
    }
  }
  if (room.members.length === 1) {
    return 'Only the creator is in the room — no agent invited yet.';
  }
  return null;
}
