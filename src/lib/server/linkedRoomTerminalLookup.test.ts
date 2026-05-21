import { beforeEach, describe, expect, it } from 'vitest';
import { isLinkedChatRoom } from './linkedRoomTerminalLookup';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { getIdentityDb } from './db';

// LINKED-CHAT-LISTING-FILTER (2026-05-15, JWPK): isLinkedChatRoom is the
// canonical "is this chat room attached to a terminal" predicate. Tests
// pin all four edge cases: linked / non-linked / null-pointer / blank id.

function insertTerminalRecord(args: {
  sessionId: string;
  linkedChatRoomId: string | null;
}): void {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO terminal_records
       (session_id, name, auto_forward_chat, created_at_ms, updated_at_ms, linked_chat_room_id)
       VALUES (?, ?, 1, ?, ?, ?)`
  ).run(
    args.sessionId,
    `terminal-${args.sessionId}`,
    now,
    now,
    args.linkedChatRoomId
  );
}

function clearTerminalRecords(): void {
  getIdentityDb().prepare('DELETE FROM terminal_records').run();
}

describe('isLinkedChatRoom', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    clearTerminalRecords();
  });

  it('returns true when a terminal_records row points at the room', () => {
    const linkedRoom = createChatRoom({ name: 'Terminal: alpha', whoCreatedIt: '@you' });
    insertTerminalRecord({ sessionId: 'sess-alpha', linkedChatRoomId: linkedRoom.id });
    expect(isLinkedChatRoom(linkedRoom.id)).toBe(true);
  });

  it('returns false for a normal chat room with no terminal binding', () => {
    const normalRoom = createChatRoom({ name: 'normal', whoCreatedIt: '@you' });
    expect(isLinkedChatRoom(normalRoom.id)).toBe(false);
  });

  it('returns false when a terminal_records row has NULL linked_chat_room_id', () => {
    const room = createChatRoom({ name: 'unrelated', whoCreatedIt: '@you' });
    insertTerminalRecord({ sessionId: 'sess-null', linkedChatRoomId: null });
    expect(isLinkedChatRoom(room.id)).toBe(false);
  });

  it('returns false for an unknown room id', () => {
    expect(isLinkedChatRoom('does-not-exist')).toBe(false);
  });

  it('returns false for a blank/empty string room id', () => {
    expect(isLinkedChatRoom('')).toBe(false);
  });
});
