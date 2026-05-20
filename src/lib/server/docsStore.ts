/**
 * docsStore — Task #124 v3-parity: room-scoped markdown docs.
 *
 * Stores markdown content inline (not just ref_url like artefacts).
 * Supports create, list, get, update, soft-delete.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type RoomDoc = {
  id: string;
  roomId: string;
  title: string;
  content: string;
  createdBy: string | null;
  createdAtMs: number;
  updatedAtMs: number | null;
};

type DocRow = {
  id: string;
  room_id: string;
  title: string;
  content: string;
  created_by: string | null;
  created_at_ms: number;
  updated_at_ms: number | null;
  deleted_at_ms: number | null;
};

function rowToDoc(row: DocRow): RoomDoc {
  return {
    id: row.id,
    roomId: row.room_id,
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

export function createDoc(input: {
  roomId: string;
  title: string;
  content?: string;
  createdBy?: string | null;
  nowMs?: number;
}): RoomDoc {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    throw new Error('title cannot be blank.');
  }
  const db = getIdentityDb();
  const id = randomUUID();
  const nowMs = input.nowMs ?? Date.now();
  const content = input.content ?? '';

  db.prepare(
    `INSERT INTO chat_room_docs
     (id, room_id, title, content, created_by, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.roomId, trimmedTitle, content, input.createdBy ?? null, nowMs, nowMs);

  return {
    id,
    roomId: input.roomId,
    title: trimmedTitle,
    content,
    createdBy: input.createdBy ?? null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
}

export function listDocsInRoom(roomId: string): RoomDoc[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, title, content, created_by, created_at_ms, updated_at_ms, deleted_at_ms
         FROM chat_room_docs
        WHERE room_id = ? AND deleted_at_ms IS NULL
        ORDER BY updated_at_ms DESC, created_at_ms DESC`
    )
    .all(roomId) as DocRow[];
  return rows.map(rowToDoc);
}

export function getDoc(id: string): RoomDoc | undefined {
  const row = getIdentityDb()
    .prepare(
      `SELECT id, room_id, title, content, created_by, created_at_ms, updated_at_ms, deleted_at_ms
         FROM chat_room_docs
        WHERE id = ? AND deleted_at_ms IS NULL`
    )
    .get(id) as DocRow | undefined;
  return row ? rowToDoc(row) : undefined;
}

export function updateDoc(id: string, input: {
  title?: string;
  content?: string;
  nowMs?: number;
}): RoomDoc | undefined {
  const db = getIdentityDb();
  const existing = getDoc(id);
  if (!existing) return undefined;

  const nowMs = input.nowMs ?? Date.now();
  const title = input.title !== undefined ? input.title.trim() : existing.title;
  const content = input.content !== undefined ? input.content : existing.content;

  if (title.length === 0) {
    throw new Error('title cannot be blank.');
  }

  db.prepare(
    `UPDATE chat_room_docs
        SET title = ?, content = ?, updated_at_ms = ?
      WHERE id = ? AND deleted_at_ms IS NULL`
  ).run(title, content, nowMs, id);

  return { ...existing, title, content, updatedAtMs: nowMs };
}

export function softDeleteDoc(id: string, nowMs?: number): boolean {
  const result = getIdentityDb()
    .prepare(
      `UPDATE chat_room_docs
          SET deleted_at_ms = ?
        WHERE id = ? AND deleted_at_ms IS NULL`
    )
    .run(nowMs ?? Date.now(), id);
  return result.changes > 0;
}

export function resetDocsStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM chat_room_docs`).run();
}
