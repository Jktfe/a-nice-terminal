import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import {
  createFileRefInRoom,
  listFileRefsInRoom,
  softDeleteFileRef,
  resetChatRoomFileRefStoreForTests
} from './chatRoomFileRefStore';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatRoomFileRefStoreForTests();
});

afterEach(() => {
  resetChatRoomFileRefStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('chatRoomFileRefStore', () => {
  it('creates a file ref in a room', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const ref = createFileRefInRoom({
      roomId: room.id,
      filePath: '/tmp/test.txt',
      note: 'Test',
    });
    expect(ref.roomId).toBe(room.id);
    expect(ref.filePath).toBe('/tmp/test.txt');
    expect(ref.note).toBe('Test');
  });

  it('lists file refs in a room', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const room2 = createChatRoom({ name: 'Room 2', whoCreatedIt: '@you' });
    createFileRefInRoom({ roomId: room1.id, filePath: '/tmp/a.txt' });
    createFileRefInRoom({ roomId: room1.id, filePath: '/tmp/b.txt' });
    createFileRefInRoom({ roomId: room2.id, filePath: '/tmp/c.txt' });
    const refs = listFileRefsInRoom(room1.id);
    expect(refs.length).toBe(2);
    expect(refs.map((r) => r.filePath)).toContain('/tmp/a.txt');
    expect(refs.map((r) => r.filePath)).toContain('/tmp/b.txt');
  });

  it('soft-deletes a file ref', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const ref = createFileRefInRoom({ roomId: room.id, filePath: '/tmp/del.txt' });
    const ok = softDeleteFileRef(ref.id);
    expect(ok).toBe(true);
    const refs = listFileRefsInRoom(room.id);
    expect(refs.length).toBe(0);
  });

  it('softDelete returns false for unknown id', () => {
    const ok = softDeleteFileRef('missing');
    expect(ok).toBe(false);
  });
});
