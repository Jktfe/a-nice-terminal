import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  doesChatRoomExist,
  findChatRoomById,
  listChatRooms,
  renameChatRoom,
  resetChatRoomStoreForTests,
  softDeleteChatRoom
} from './chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from './chatMessageStore';
import { getIdentityDb } from './db';

// LINKED-CHAT-LISTING-FILTER tests need to drop a terminal_records row
// whose linked_chat_room_id points at a real chat_room. We insert
// directly via SQL because there's no public helper for synthesising a
// linked terminal from the chat store's test surface.
function markRoomAsLinkedToTerminal(roomId: string, sessionId: string): void {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO terminal_records
       (session_id, name, auto_forward_chat, created_at_ms, updated_at_ms, linked_chat_room_id)
       VALUES (?, ?, 1, ?, ?, ?)`
  ).run(sessionId, `terminal-${sessionId}`, now, now, roomId);
}

function clearTerminalRecords(): void {
  getIdentityDb().prepare('DELETE FROM terminal_records').run();
}

describe('chatRoomStore', () => {
  beforeEach(() => {
    resetChatMessageStoreForTests();
    resetChatRoomStoreForTests();
    clearTerminalRecords();
  });

  it('createChatRoom returns a room with the given name', () => {
    const created = createChatRoom({ name: 'fresh-ant build', whoCreatedIt: '@you' });
    expect(created.name).toBe('fresh-ant build');
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.id.includes('room_')).toBe(false);
    expect(created.attentionState).toBe('ready');
  });

  it('createChatRoom rejects an empty name', () => {
    expect(() => createChatRoom({ name: '   ', whoCreatedIt: '@you' })).toThrow();
  });

  it('listChatRooms returns the newest room first', () => {
    const olderRoom = createChatRoom({ name: 'older room', whoCreatedIt: '@you' });
    const newerRoom = createChatRoom({ name: 'newer room', whoCreatedIt: '@you' });
    const list = listChatRooms();
    const indexOfNewer = list.findIndex((room) => room.id === newerRoom.id);
    const indexOfOlder = list.findIndex((room) => room.id === olderRoom.id);
    expect(indexOfNewer).toBeLessThan(indexOfOlder);
  });

  it('listChatRooms summarizes the latest message instead of the fresh-room placeholder', () => {
    const room = createChatRoom({ name: 'active room', whoCreatedIt: '@you' });
    postMessage({
      roomId: room.id,
      authorHandle: '@evolveantcodex',
      body: 'deploy-done abc123 #145 room-card summaries now use real state'
    });

    const listed = listChatRooms().find((candidate) => candidate.id === room.id);

    expect(listed?.summary).toBe(
      '@evolveantcodex: deploy-done abc123 #145 room-card summaries now use real state'
    );
  });

  it('listChatRooms truncates long latest-message summaries', () => {
    const room = createChatRoom({ name: 'active room', whoCreatedIt: '@you' });
    postMessage({
      roomId: room.id,
      authorHandle: '@evolveantcodex',
      body: 'x'.repeat(120)
    });

    const listed = listChatRooms().find((candidate) => candidate.id === room.id);

    expect(listed?.summary.length).toBeLessThanOrEqual(80);
    expect(listed?.summary.endsWith('…')).toBe(true);
  });

  it('listChatRooms only uses the fresh-room placeholder for truly empty rooms', () => {
    const room = createChatRoom({ name: 'empty room', whoCreatedIt: '@you' });

    const listed = listChatRooms().find((candidate) => candidate.id === room.id);

    expect(listed?.summary).toBe('Fresh room. Invite an agent or post a first message to get started.');
  });

  it('findChatRoomById returns the room when it exists', () => {
    const created = createChatRoom({ name: 'find me', whoCreatedIt: '@you' });
    const found = findChatRoomById(created.id);
    expect(found?.id).toBe(created.id);
  });

  it('findChatRoomById returns undefined for an unknown id', () => {
    expect(findChatRoomById('does_not_exist')).toBeUndefined();
  });

  it('renameChatRoom updates room.name and returns the previous name', () => {
    const room = createChatRoom({ name: 'before-rename', whoCreatedIt: '@you' });
    const { previousName, chatRoom: updated } = renameChatRoom({
      roomId: room.id,
      newName: 'after-rename'
    });
    expect(previousName).toBe('before-rename');
    expect(updated.name).toBe('after-rename');
    expect(findChatRoomById(room.id)?.name).toBe('after-rename');
  });

  it('renameChatRoom trims whitespace from the new name', () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const { chatRoom: updated } = renameChatRoom({
      roomId: room.id,
      newName: '   space-trimmed   '
    });
    expect(updated.name).toBe('space-trimmed');
  });

  it('renameChatRoom rejects a blank new name', () => {
    const room = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    expect(() =>
      renameChatRoom({ roomId: room.id, newName: '   ' })
    ).toThrow();
  });

  it('renameChatRoom throws on unknown room id', () => {
    expect(() =>
      renameChatRoom({ roomId: 'does_not_exist', newName: 'whatever' })
    ).toThrow();
  });

  // M-SHARED-SCREENSHOTS T3b — chat_rooms.deleted_at_ms soft-delete (JWPK Q-E).
  it('softDeleteChatRoom hides the room from listChatRooms', () => {
    const keep = createChatRoom({ name: 'keep me', whoCreatedIt: '@you' });
    const gone = createChatRoom({ name: 'soft-delete me', whoCreatedIt: '@you' });
    expect(softDeleteChatRoom(gone.id)).toBe(true);
    const rooms = listChatRooms();
    expect(rooms.map((r) => r.id)).toContain(keep.id);
    expect(rooms.map((r) => r.id)).not.toContain(gone.id);
  });

  it('softDeleteChatRoom flips doesChatRoomExist + findChatRoomById to false/undefined', () => {
    const room = createChatRoom({ name: 'flip', whoCreatedIt: '@you' });
    expect(doesChatRoomExist(room.id)).toBe(true);
    softDeleteChatRoom(room.id);
    expect(doesChatRoomExist(room.id)).toBe(false);
    expect(findChatRoomById(room.id)).toBeUndefined();
  });

  it('softDeleteChatRoom is idempotent — second call returns false', () => {
    const room = createChatRoom({ name: 'idemp', whoCreatedIt: '@you' });
    expect(softDeleteChatRoom(room.id)).toBe(true);
    expect(softDeleteChatRoom(room.id)).toBe(false);
  });

  it('softDeleteChatRoom on unknown room id returns false (no-op)', () => {
    expect(softDeleteChatRoom('phantom-room-id')).toBe(false);
  });

  // LINKED-CHAT-LISTING-FILTER (2026-05-15, JWPK):
  describe('listChatRooms excludes linked chats', () => {
    it('a room referenced by terminal_records.linked_chat_room_id is omitted', () => {
      const normalRoom = createChatRoom({ name: 'normal', whoCreatedIt: '@you' });
      const linkedRoom = createChatRoom({ name: 'Terminal: foo', whoCreatedIt: '@you' });
      markRoomAsLinkedToTerminal(linkedRoom.id, 'sess-foo');

      const ids = listChatRooms().map((r) => r.id);
      expect(ids).toContain(normalRoom.id);
      expect(ids).not.toContain(linkedRoom.id);
    });

    it('findChatRoomById still returns linked rooms (listing-only filter)', () => {
      const linkedRoom = createChatRoom({ name: 'Terminal: bar', whoCreatedIt: '@you' });
      markRoomAsLinkedToTerminal(linkedRoom.id, 'sess-bar');

      const found = findChatRoomById(linkedRoom.id);
      expect(found?.id).toBe(linkedRoom.id);
      expect(doesChatRoomExist(linkedRoom.id)).toBe(true);
    });

    it('a terminal_records row with NULL linked_chat_room_id does not hide any rooms', () => {
      const r1 = createChatRoom({ name: 'one', whoCreatedIt: '@you' });
      const r2 = createChatRoom({ name: 'two', whoCreatedIt: '@you' });
      // Insert a terminal_record with linked_chat_room_id = NULL — must
      // not break the NOT IN filter (SQLite NOT IN + NULL trap).
      const db = getIdentityDb();
      const now = Date.now();
      db.prepare(
        `INSERT INTO terminal_records
           (session_id, name, auto_forward_chat, created_at_ms, updated_at_ms, linked_chat_room_id)
           VALUES (?, ?, 1, ?, ?, NULL)`
      ).run('sess-null', 'terminal-null', now, now);

      const ids = listChatRooms().map((r) => r.id);
      expect(ids).toContain(r1.id);
      expect(ids).toContain(r2.id);
    });
  });
});
