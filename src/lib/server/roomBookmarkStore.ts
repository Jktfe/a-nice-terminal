import { getIdentityDb } from './db';
import { getOperatorHandle } from './operatorHandle';

export type RoomBookmark = {
  ownerHandle: string;
  roomId: string;
  orderIndex: number;
  createdAtMs: number;
  updatedAtMs: number;
};

type BookmarkRow = {
  owner_handle: string;
  room_id: string;
  order_index: number;
  created_at_ms: number;
  updated_at_ms: number;
};

function rowToBookmark(row: BookmarkRow): RoomBookmark {
  return {
    ownerHandle: row.owner_handle,
    roomId: row.room_id,
    orderIndex: row.order_index,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

export function listRoomBookmarks(ownerHandle = getOperatorHandle()): RoomBookmark[] {
  return getIdentityDb()
    .prepare(
      `SELECT owner_handle, room_id, order_index, created_at_ms, updated_at_ms
       FROM room_bookmarks
       WHERE owner_handle = ?
       ORDER BY order_index ASC, updated_at_ms ASC`
    )
    .all(ownerHandle)
    .map((row) => rowToBookmark(row as BookmarkRow));
}

export function replaceRoomBookmarks(ownerHandle: string, roomIds: string[]): RoomBookmark[] {
  const uniqueRoomIds = [...new Set(roomIds.map((id) => id.trim()).filter(Boolean))];
  const now = Date.now();
  const db = getIdentityDb();
  const existingCreatedAt = new Map<string, number>(
    listRoomBookmarks(ownerHandle).map((bookmark) => [bookmark.roomId, bookmark.createdAtMs])
  );

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM room_bookmarks WHERE owner_handle = ?`).run(ownerHandle);
    const insert = db.prepare(
      `INSERT INTO room_bookmarks (owner_handle, room_id, order_index, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)`
    );
    uniqueRoomIds.forEach((roomId, index) => {
      insert.run(ownerHandle, roomId, index, existingCreatedAt.get(roomId) ?? now, now);
    });
  });
  tx();

  return listRoomBookmarks(ownerHandle);
}

export function resetRoomBookmarkStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM room_bookmarks`).run();
}
