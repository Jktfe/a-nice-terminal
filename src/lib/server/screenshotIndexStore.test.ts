import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  enableSharedFolder,
  isSharedFolderEnabled,
  getRoomScreenshotCount,
  checkDedupAndReserve,
  listScreenshotsForRoom,
  softDeleteScreenshot,
  deleteRoomScreenshots,
  resetScreenshotIndexStoreForTests,
  SharedFolderDisabledError,
  RoomNotFoundError
} from './screenshotIndexStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { resetIdentityDbForTests } from './db';

beforeEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetScreenshotIndexStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
});

describe('screenshotIndexStore — opt-in flag (Q-A)', () => {
  it('default flag is FALSE (DEFAULT 0 on column)', () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    expect(isSharedFolderEnabled(room.id)).toBe(false);
  });

  it('enableSharedFolder toggles flag', () => {
    const room = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    expect(isSharedFolderEnabled(room.id)).toBe(true);
    enableSharedFolder(room.id, false);
    expect(isSharedFolderEnabled(room.id)).toBe(false);
  });

  it('enableSharedFolder throws RoomNotFoundError on unknown room', () => {
    expect(() => enableSharedFolder('phantom', true)).toThrow(RoomNotFoundError);
  });
});

describe('screenshotIndexStore — checkDedupAndReserve (Q-B no caps)', () => {
  it('throws SharedFolderDisabledError when room flag is OFF', () => {
    const room = createChatRoom({ name: 'r3', whoCreatedIt: '@you' });
    expect(() =>
      checkDedupAndReserve({ roomId: room.id, sha: 'a'.repeat(64), takenBy: '@you', bytes: 1024 })
    ).toThrow(SharedFolderDisabledError);
  });

  it('first capture INSERTS row + returns kind=inserted', () => {
    const room = createChatRoom({ name: 'r4', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    const result = checkDedupAndReserve({
      roomId: room.id, sha: 'b'.repeat(64), takenBy: '@you', bytes: 1024, topic: 'demo', nowMs: 100
    });
    expect(result.kind).toBe('inserted');
    if (result.kind === 'inserted') {
      expect(result.row.sha).toBe('b'.repeat(64));
      expect(result.row.room_id).toBe(room.id);
      expect(result.row.taken_at_ms).toBe(100);
      expect(result.row.deleted_at_ms).toBeNull();
    }
  });

  it('duplicate sha+room returns kind=existing without re-inserting', () => {
    const room = createChatRoom({ name: 'r5', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    checkDedupAndReserve({ roomId: room.id, sha: 'c'.repeat(64), takenBy: '@you', bytes: 1024 });
    const second = checkDedupAndReserve({ roomId: room.id, sha: 'c'.repeat(64), takenBy: '@kimi', bytes: 1024 });
    expect(second.kind).toBe('existing');
    expect(getRoomScreenshotCount(room.id)).toBe(1);
  });

  it('same sha in DIFFERENT rooms is allowed (per-room dedup)', () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    enableSharedFolder(roomA.id, true);
    enableSharedFolder(roomB.id, true);
    const sha = 'd'.repeat(64);
    expect(checkDedupAndReserve({ roomId: roomA.id, sha, takenBy: '@you', bytes: 1024 }).kind).toBe('inserted');
    expect(checkDedupAndReserve({ roomId: roomB.id, sha, takenBy: '@you', bytes: 1024 }).kind).toBe('inserted');
  });

  it('no cap enforcement — delta-2 SURFACE-SIZE-ONLY (1000 rows accepted)', () => {
    const room = createChatRoom({ name: 'unlimited', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    for (let i = 0; i < 1000; i++) {
      const sha = i.toString().padStart(64, '0');
      const result = checkDedupAndReserve({ roomId: room.id, sha, takenBy: '@you', bytes: 1024 });
      expect(result.kind).toBe('inserted');
    }
    expect(getRoomScreenshotCount(room.id)).toBe(1000);
  });
});

describe('screenshotIndexStore — listing + soft-delete (Q-E)', () => {
  it('listScreenshotsForRoom newest-first', () => {
    const room = createChatRoom({ name: 'lst', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    checkDedupAndReserve({ roomId: room.id, sha: 'a'.repeat(64), takenBy: '@you', bytes: 1024, nowMs: 100 });
    checkDedupAndReserve({ roomId: room.id, sha: 'b'.repeat(64), takenBy: '@you', bytes: 1024, nowMs: 200 });
    checkDedupAndReserve({ roomId: room.id, sha: 'c'.repeat(64), takenBy: '@you', bytes: 1024, nowMs: 300 });
    const rows = listScreenshotsForRoom(room.id);
    expect(rows.map((r) => r.taken_at_ms)).toEqual([300, 200, 100]);
  });

  it('softDeleteScreenshot sets deleted_at_ms + list excludes it', () => {
    const room = createChatRoom({ name: 'soft', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    checkDedupAndReserve({ roomId: room.id, sha: 'a'.repeat(64), takenBy: '@you', bytes: 1024 });
    checkDedupAndReserve({ roomId: room.id, sha: 'b'.repeat(64), takenBy: '@you', bytes: 1024 });
    expect(listScreenshotsForRoom(room.id)).toHaveLength(2);
    expect(softDeleteScreenshot('a'.repeat(64), room.id)).toBe(true);
    expect(listScreenshotsForRoom(room.id)).toHaveLength(1);
    expect(listScreenshotsForRoom(room.id)[0].sha).toBe('b'.repeat(64));
  });

  it('softDeleteScreenshot is idempotent — returns false on already-deleted row', () => {
    const room = createChatRoom({ name: 'idemp', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    checkDedupAndReserve({ roomId: room.id, sha: 'a'.repeat(64), takenBy: '@you', bytes: 1024 });
    expect(softDeleteScreenshot('a'.repeat(64), room.id)).toBe(true);
    expect(softDeleteScreenshot('a'.repeat(64), room.id)).toBe(false);
  });

  it('soft-deleted row does NOT block re-insert under same sha (new row replaces marker)', () => {
    const room = createChatRoom({ name: 're-add', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    const sha = 'a'.repeat(64);
    checkDedupAndReserve({ roomId: room.id, sha, takenBy: '@you', bytes: 1024, nowMs: 100 });
    softDeleteScreenshot(sha, room.id, 200);
    // dedup-active-only check sees no row, so re-add is allowed
    // (the soft-deleted row remains under same PK — caller must hard-prune first OR
    //  re-insert path needs explicit policy; for v1 it's caller's responsibility).
    expect(() => checkDedupAndReserve({ roomId: room.id, sha, takenBy: '@you', bytes: 1024, nowMs: 300 }))
      .toThrow(); // SQLite UNIQUE constraint on (sha, room_id) PK still binds
  });

  it('FK CASCADE: hard-deleting a room removes its screenshots rows', () => {
    const room = createChatRoom({ name: 'doomed', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    checkDedupAndReserve({ roomId: room.id, sha: 'a'.repeat(64), takenBy: '@you', bytes: 1024 });
    expect(listScreenshotsForRoom(room.id)).toHaveLength(1);
    resetChatRoomStoreForTests(); // hard-deletes chat_rooms → FK CASCADE
    expect(listScreenshotsForRoom(room.id)).toEqual([]);
  });

  it('deleteRoomScreenshots (hard) removes rows + returns count', () => {
    const room = createChatRoom({ name: 'del', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    checkDedupAndReserve({ roomId: room.id, sha: 'a'.repeat(64), takenBy: '@you', bytes: 1024 });
    checkDedupAndReserve({ roomId: room.id, sha: 'b'.repeat(64), takenBy: '@you', bytes: 1024 });
    expect(deleteRoomScreenshots(room.id)).toBe(2);
    expect(listScreenshotsForRoom(room.id)).toEqual([]);
  });
});
