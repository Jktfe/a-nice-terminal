/**
 * Message search store — finds messages whose body contains a query, across
 * every chat room or scoped to one.
 *
 * Vertical slice for M14 search-across-rooms. Pure consumer of the existing
 * chatRoomStore + chatMessageStore APIs, so it never goes stale relative to
 * posts and stays out of the path of every other in-flight milestone (M13
 * rename, M03 slice 5 remove, claude2's prior-collaborators wiring).
 *
 * Public functions:
 *   - searchMessages              returns matching messages, newest first
 *   - resetMessageSearchStoreForTests  no-op (kept for parity)
 *
 * Replaces in a later milestone with a SQLite FTS index. Public function
 * names stay the same, so the /search page won't change when the swap lands.
 */

import { listChatRooms, findChatRoomById } from './chatRoomStore';
import {
  listMessagesAfterLatestBreak,
  listMessagesInRoom,
  type ChatMessage
} from './chatMessageStore';
import { filterVisibleMessages } from './visibleContentScope';

const DEFAULT_RESULT_LIMIT = 50;
const HIGHEST_ALLOWED_LIMIT = 200;

export type MessageSearchHit = {
  message: ChatMessage;
  roomId: string;
  roomName: string;
};

export function searchMessages(input: {
  query: string;
  roomId?: string;
  limit?: number;
  afterLatestBreakOnly?: boolean;
}): MessageSearchHit[] {
  const trimmedQuery = input.query.trim();
  if (trimmedQuery.length === 0) {
    throw new Error('A search query needs at least one non-blank character.');
  }

  const effectiveLimit = clampLimit(input.limit);
  const queryInLowercase = trimmedQuery.toLowerCase();

  const roomsToSearch = collectRoomsToSearch(input.roomId);
  const allHits: MessageSearchHit[] = [];

  for (const room of roomsToSearch) {
    const currentBlockMessages = input.afterLatestBreakOnly === true
      ? listMessagesAfterLatestBreak(room.id)
      : undefined;
    const currentBlockIds = currentBlockMessages === undefined
      ? undefined
      : new Set(currentBlockMessages.map((message) => message.id));
    const messages = filterVisibleMessages(listMessagesInRoom(room.id), { currentBlockIds });
    for (const message of messages) {
      if (message.body.toLowerCase().includes(queryInLowercase)) {
        allHits.push({ message, roomId: room.id, roomName: room.name });
      }
    }
  }

  allHits.sort((a, b) => b.message.postOrder - a.message.postOrder);
  return allHits.slice(0, effectiveLimit);
}

/**
 * Per-room search shim used by `/api/chat-rooms/:roomId/search`
 * (JWPK 2026-05-16). Thin wrapper over `searchMessages` that pins the
 * room scope — the route file imports this directly so callers don't
 * need to know the search-input envelope shape.
 */
export function searchMessagesInRoom(
  roomId: string,
  query: string,
  limit?: number,
  options: { afterLatestBreakOnly?: boolean } = {}
): MessageSearchHit[] {
  return searchMessages({ query, roomId, limit, afterLatestBreakOnly: options.afterLatestBreakOnly });
}

export function resetMessageSearchStoreForTests(): void {
  // The store keeps no state of its own — it derives everything from the
  // chat room + message stores. This function exists so test setup blocks
  // can call it uniformly alongside resetChatRoomStoreForTests etc.
}

function clampLimit(rawLimit: number | undefined): number {
  if (rawLimit === undefined) return DEFAULT_RESULT_LIMIT;
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) return DEFAULT_RESULT_LIMIT;
  return Math.min(Math.floor(rawLimit), HIGHEST_ALLOWED_LIMIT);
}

function collectRoomsToSearch(roomIdOrUndefined: string | undefined): Array<{ id: string; name: string }> {
  if (roomIdOrUndefined === undefined) {
    return listChatRooms().map((room) => ({ id: room.id, name: room.name }));
  }
  const oneRoom = findChatRoomById(roomIdOrUndefined);
  if (!oneRoom) {
    throw new Error(`No room found with id ${roomIdOrUndefined}.`);
  }
  return [{ id: oneRoom.id, name: oneRoom.name }];
}
