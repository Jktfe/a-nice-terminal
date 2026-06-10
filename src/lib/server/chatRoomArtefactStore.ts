/**
 * chatRoomArtefactStore — Task #91/#98 v3 parity.
 *
 * Per-room artefact registry that backs the Artefacts collapsible in
 * the room view: HTML, decks, spreadsheets, docs, mockups, others.
 * One row per artefact; binary storage stays in chatAttachmentStore so
 * each artefact row is a small metadata + ref pointer.
 *
 * Soft-delete via deleted_at_ms so an accidental remove doesn't drop
 * the audit trail.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export const ARTEFACT_KINDS = [
  'html',
  'deck',
  'stage',
  'spreadsheet',
  'doc',
  'mockup',
  'tracker',
  'other'
] as const;

export type ArtefactKind = (typeof ARTEFACT_KINDS)[number];

export type RoomArtefact = {
  id: string;
  roomId: string;
  kind: ArtefactKind;
  title: string;
  refUrl: string | null;
  summary: string | null;
  createdBy: string | null;
  createdAtMs: number;
};

type ArtefactRow = {
  id: string;
  room_id: string;
  kind: string;
  title: string;
  ref_url: string | null;
  summary: string | null;
  created_by: string | null;
  created_at_ms: number;
  deleted_at_ms: number | null;
};

export function isKnownArtefactKind(value: unknown): value is ArtefactKind {
  return typeof value === 'string' && (ARTEFACT_KINDS as readonly string[]).includes(value);
}

function rowToArtefact(row: ArtefactRow): RoomArtefact {
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind as ArtefactKind,
    title: row.title,
    refUrl: row.ref_url,
    summary: row.summary,
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms
  };
}

export function createArtefactInRoom(input: {
  id?: string;
  roomId: string;
  kind: ArtefactKind;
  title: string;
  refUrl?: string | null;
  summary?: string | null;
  createdBy?: string | null;
  nowMs?: number;
}): RoomArtefact {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    throw new Error('title cannot be blank.');
  }
  const db = getIdentityDb();
  const id = input.id ?? randomUUID();
  const createdAtMs = input.nowMs ?? Date.now();
  db.prepare(
    `INSERT INTO chat_room_artefacts
     (id, room_id, kind, title, ref_url, summary, created_by, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.roomId,
    input.kind,
    trimmedTitle,
    input.refUrl ?? null,
    input.summary ?? null,
    input.createdBy ?? null,
    createdAtMs
  );
  return {
    id,
    roomId: input.roomId,
    kind: input.kind,
    title: trimmedTitle,
    refUrl: input.refUrl ?? null,
    summary: input.summary ?? null,
    createdBy: input.createdBy ?? null,
    createdAtMs
  };
}

export function listArtefactsInRoom(roomId: string): RoomArtefact[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, kind, title, ref_url, summary, created_by, created_at_ms, deleted_at_ms
         FROM chat_room_artefacts
        WHERE room_id = ? AND deleted_at_ms IS NULL
        ORDER BY kind ASC, created_at_ms DESC`
    )
    .all(roomId) as ArtefactRow[];
  return rows.map(rowToArtefact);
}

export function getArtefact(artefactId: string): RoomArtefact | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT id, room_id, kind, title, ref_url, summary, created_by, created_at_ms, deleted_at_ms
         FROM chat_room_artefacts
        WHERE id = ? AND deleted_at_ms IS NULL`
    )
    .get(artefactId) as ArtefactRow | undefined;
  return row ? rowToArtefact(row) : null;
}

export function softDeleteArtefact(artefactId: string, nowMs?: number): boolean {
  const result = getIdentityDb()
    .prepare(
      `UPDATE chat_room_artefacts
          SET deleted_at_ms = ?
        WHERE id = ? AND deleted_at_ms IS NULL`
    )
    .run(nowMs ?? Date.now(), artefactId);
  return result.changes > 0;
}

export function resetChatRoomArtefactStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM chat_room_artefacts`).run();
}
