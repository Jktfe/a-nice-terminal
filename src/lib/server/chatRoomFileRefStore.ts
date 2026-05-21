/**
 * chatRoomFileRefStore — Task #111 v3-parity.
 *
 * Lets a room flag a file path with an optional note. Conceptually
 * narrower than the artefacts panel: a path, a note, who flagged it.
 * Soft-delete via deleted_at_ms so the audit trail survives a remove.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type FileRef = {
  id: string;
  roomId: string;
  filePath: string;
  note: string | null;
  flaggedBy: string | null;
  createdAtMs: number;
};

type FileRefRow = {
  id: string;
  room_id: string;
  file_path: string;
  note: string | null;
  flagged_by: string | null;
  created_at_ms: number;
  deleted_at_ms: number | null;
};

function rowToFileRef(row: FileRefRow): FileRef {
  return {
    id: row.id,
    roomId: row.room_id,
    filePath: row.file_path,
    note: row.note,
    flaggedBy: row.flagged_by,
    createdAtMs: row.created_at_ms
  };
}

export function createFileRefInRoom(input: {
  roomId: string;
  filePath: string;
  note?: string | null;
  flaggedBy?: string | null;
  nowMs?: number;
}): FileRef {
  const trimmedPath = input.filePath.trim();
  if (trimmedPath.length === 0) {
    throw new Error('filePath cannot be blank.');
  }
  const db = getIdentityDb();
  const id = randomUUID();
  const createdAtMs = input.nowMs ?? Date.now();
  db.prepare(
    `INSERT INTO chat_room_file_refs
     (id, room_id, file_path, note, flagged_by, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.roomId,
    trimmedPath,
    input.note ?? null,
    input.flaggedBy ?? null,
    createdAtMs
  );
  return {
    id,
    roomId: input.roomId,
    filePath: trimmedPath,
    note: input.note ?? null,
    flaggedBy: input.flaggedBy ?? null,
    createdAtMs
  };
}

export function listFileRefsInRoom(roomId: string): FileRef[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, file_path, note, flagged_by, created_at_ms, deleted_at_ms
         FROM chat_room_file_refs
        WHERE room_id = ? AND deleted_at_ms IS NULL
        ORDER BY created_at_ms DESC`
    )
    .all(roomId) as FileRefRow[];
  return rows.map(rowToFileRef);
}

export function softDeleteFileRef(fileRefId: string, nowMs?: number): boolean {
  const result = getIdentityDb()
    .prepare(
      `UPDATE chat_room_file_refs
          SET deleted_at_ms = ?
        WHERE id = ? AND deleted_at_ms IS NULL`
    )
    .run(nowMs ?? Date.now(), fileRefId);
  return result.changes > 0;
}

export function resetChatRoomFileRefStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM chat_room_file_refs`).run();
}
