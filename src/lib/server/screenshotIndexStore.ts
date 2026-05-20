/**
 * screenshotIndexStore — M-SHARED-SCREENSHOTS T1 + T3a delta-2.
 *
 * JWPK Q-A/Q-E locked answers (2026-05-14):
 *   Q-A: per-room opt-in default OFF (chat_rooms.shared_folder_enabled).
 *   Q-B: SURFACE-SIZE-ONLY — NO storage cap, NO TTL, NO purge cron.
 *   Q-C: agent + chat-context captures share the room directory.
 *   Q-D: existing flat /uploads attachments stay flat (no migration).
 *   Q-E: SOFT-DELETE — prune sets deleted_at_ms; files survive on disk.
 *
 * FK `screenshots.room_id REFERENCES chat_rooms(id) ON DELETE CASCADE`
 * stays as-is — SQLite cannot ALTER FK without table-rebuild (RQO delta-2
 * caution). Room-preservation under deletion is achieved at the chat_rooms
 * layer (T3b adds chat_rooms.deleted_at_ms so rooms become soft-deletable).
 *
 * Q3 dedup flow inside `checkDedupAndReserve` (delta-2):
 *   single SQLite transaction = enabled-flag check → existing-row
 *   check → INSERT. No cap check (Q-B). Caller renames the temp file
 *   onto canonical path AFTER this returns { kind: 'inserted' }.
 */
import { getIdentityDb } from './db';
import { findChatRoomById } from './chatRoomStore';

export type ScreenshotRow = {
  sha: string;
  room_id: string;
  taken_by: string;
  taken_at_ms: number;
  bytes: number;
  topic: string | null;
  dimensions: string | null;
  parent_sha: string | null;
  ttl_until_ms: number | null;
  deck_slug: string | null;
  deleted_at_ms: number | null;
};

export class SharedFolderDisabledError extends Error {
  constructor(roomId: string) {
    super(`Shared screenshot folder is not enabled for room ${roomId}.`);
    this.name = 'SharedFolderDisabledError';
  }
}

export class RoomNotFoundError extends Error {
  constructor(roomId: string) {
    super(`No room found with id ${roomId}.`);
    this.name = 'RoomNotFoundError';
  }
}

export function isSharedFolderEnabled(roomId: string): boolean {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT shared_folder_enabled AS v FROM chat_rooms WHERE id = ?`)
    .get(roomId) as { v: number } | undefined;
  return row?.v === 1;
}

export function enableSharedFolder(roomId: string, enabled: boolean): void {
  if (!findChatRoomById(roomId)) throw new RoomNotFoundError(roomId);
  const db = getIdentityDb();
  db.prepare(`UPDATE chat_rooms SET shared_folder_enabled = ? WHERE id = ?`).run(
    enabled ? 1 : 0, roomId
  );
}

export function getRoomScreenshotCount(roomId: string): number {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM screenshots
              WHERE room_id = ? AND deleted_at_ms IS NULL`)
    .get(roomId) as { n: number };
  return row.n;
}

export type ReserveResult =
  | { kind: 'existing'; row: ScreenshotRow }
  | { kind: 'inserted'; row: ScreenshotRow };

export type ReserveInput = {
  roomId: string;
  sha: string;
  takenBy: string;
  bytes: number;
  topic?: string;
  dimensions?: string;
  parentSha?: string;
  ttlMs?: number | null;
  deckSlug?: string;
  nowMs?: number;
};

/**
 * Atomic: shared-folder-enabled check + existing-row check + INSERT.
 * No cap enforcement per JWPK Q-B (SURFACE-SIZE-ONLY). Caller renames
 * the temp file onto canonical path AFTER this returns 'inserted'.
 */
export function checkDedupAndReserve(input: ReserveInput): ReserveResult {
  if (!findChatRoomById(input.roomId)) throw new RoomNotFoundError(input.roomId);
  if (!isSharedFolderEnabled(input.roomId)) {
    throw new SharedFolderDisabledError(input.roomId);
  }

  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  let resultHolder: ReserveResult | null = null;

  const txn = db.transaction(() => {
    const existing = db
      .prepare(`SELECT * FROM screenshots
                WHERE sha = ? AND room_id = ? AND deleted_at_ms IS NULL`)
      .get(input.sha, input.roomId) as ScreenshotRow | undefined;
    if (existing) {
      resultHolder = { kind: 'existing', row: existing };
      return;
    }
    db.prepare(`INSERT INTO screenshots
      (sha, room_id, taken_by, taken_at_ms, bytes, topic, dimensions, parent_sha, ttl_until_ms, deck_slug)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.sha, input.roomId, input.takenBy, nowMs, input.bytes,
      input.topic ?? null, input.dimensions ?? null,
      input.parentSha ?? null, input.ttlMs ?? null,
      input.deckSlug ?? null
    );
    const fresh = db
      .prepare(`SELECT * FROM screenshots WHERE sha = ? AND room_id = ?`)
      .get(input.sha, input.roomId) as ScreenshotRow;
    resultHolder = { kind: 'inserted', row: fresh };
  });
  txn();
  if (!resultHolder) throw new Error('checkDedupAndReserve: unreachable');
  return resultHolder;
}

/** List active (not soft-deleted) screenshots for a room, newest first. */
export function listScreenshotsForRoom(roomId: string, limit: number = 50): ScreenshotRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM screenshots
              WHERE room_id = ? AND deleted_at_ms IS NULL
              ORDER BY taken_at_ms DESC LIMIT ?`)
    .all(roomId, limit) as ScreenshotRow[];
}

/** Soft-delete: mark a single screenshot deleted (file stays on disk). */
export function softDeleteScreenshot(sha: string, roomId: string, nowMs?: number): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(`UPDATE screenshots SET deleted_at_ms = ?
              WHERE sha = ? AND room_id = ? AND deleted_at_ms IS NULL`)
    .run(nowMs ?? Date.now(), sha, roomId);
  return info.changes > 0;
}

/** Hard-delete: used only by test reset + future explicit purge-bytes flow. */
export function deleteRoomScreenshots(roomId: string): number {
  const db = getIdentityDb();
  const info = db.prepare(`DELETE FROM screenshots WHERE room_id = ?`).run(roomId);
  return info.changes;
}

export function resetScreenshotIndexStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM screenshots').run();
  db.prepare('UPDATE chat_rooms SET shared_folder_enabled = 0').run();
}
