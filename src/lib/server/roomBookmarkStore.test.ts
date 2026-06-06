import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import {
  listRoomBookmarks,
  replaceRoomBookmarks,
  resetRoomBookmarkStoreForTests
} from './roomBookmarkStore';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetRoomBookmarkStoreForTests();
});

afterEach(() => {
  resetRoomBookmarkStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('roomBookmarkStore', () => {
  it('lists empty bookmarks by default', () => {
    const bookmarks = listRoomBookmarks('@you');
    expect(bookmarks).toEqual([]);
  });

  it('replaces bookmarks for a handle', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const room2 = createChatRoom({ name: 'Room 2', whoCreatedIt: '@you' });

    const result = replaceRoomBookmarks('@you', [room1.id, room2.id]);
    expect(result.length).toBe(2);
    expect(result[0].roomId).toBe(room1.id);
    expect(result[0].orderIndex).toBe(0);
    expect(result[1].roomId).toBe(room2.id);
    expect(result[1].orderIndex).toBe(1);
    expect(result[0].ownerHandle).toBe('@JWPK');
  });

  it('lists bookmarks ordered by order_index', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const room2 = createChatRoom({ name: 'Room 2', whoCreatedIt: '@you' });
    replaceRoomBookmarks('@you', [room2.id, room1.id]);

    const bookmarks = listRoomBookmarks('@you');
    expect(bookmarks[0].roomId).toBe(room2.id);
    expect(bookmarks[1].roomId).toBe(room1.id);
  });

  it('replaces existing bookmarks completely', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const room2 = createChatRoom({ name: 'Room 2', whoCreatedIt: '@you' });
    replaceRoomBookmarks('@you', [room1.id, room2.id]);

    const room3 = createChatRoom({ name: 'Room 3', whoCreatedIt: '@you' });
    const result = replaceRoomBookmarks('@you', [room3.id]);
    expect(result.length).toBe(1);
    expect(result[0].roomId).toBe(room3.id);
  });

  it('preserves createdAt for re-added rooms', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const first = replaceRoomBookmarks('@you', [room1.id]);
    const createdAt = first[0].createdAtMs;

    // small delay so updatedAt would differ if not preserved
    const second = replaceRoomBookmarks('@you', [room1.id]);
    expect(second[0].createdAtMs).toBe(createdAt);
    expect(second[0].updatedAtMs).toBeGreaterThanOrEqual(createdAt);
  });

  it('deduplicates and trims room ids', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const result = replaceRoomBookmarks('@you', [room1.id, ` ${room1.id} `, room1.id]);
    expect(result.length).toBe(1);
  });

  it('filters empty room ids', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const result = replaceRoomBookmarks('@you', [room1.id, '', '  ']);
    expect(result.length).toBe(1);
  });

  it('isolates bookmarks per owner handle', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    replaceRoomBookmarks('@you', [room1.id]);
    replaceRoomBookmarks('@cli', []);

    expect(listRoomBookmarks('@you').length).toBe(1);
    expect(listRoomBookmarks('@cli').length).toBe(0);
  });

  it('uses the canonical operator handle by default', () => {
    const room1 = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    replaceRoomBookmarks('@you', [room1.id]);
    expect(listRoomBookmarks().length).toBe(1);
    expect(listRoomBookmarks('@you').length).toBe(1);
  });
});
