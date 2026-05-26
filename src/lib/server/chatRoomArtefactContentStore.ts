/**
 * chatRoomArtefactContentStore — body storage for deck / doc artefacts.
 *
 * The chat_room_artefacts row holds metadata + refUrl; this store holds
 * the actual body the refUrl resolves to. One-to-one with the artefact.
 *
 * content_format is forward-compatible: 'markdown' is what we serve via
 * GET right now (renderMarkdown → HTML, iframed by /artefacts/[id]);
 * 'univer-json' is rendered by the room artefact read endpoints so the
 * canonical room artefact can be opened without a separate export step.
 */

import { getIdentityDb } from './db';

export type ArtefactContentKind = 'deck' | 'doc';
export type ArtefactContentFormat = 'markdown' | 'univer-json';

export type ArtefactContent = {
  id: string;
  artefactId: string;
  roomId: string;
  kind: ArtefactContentKind;
  contentFormat: ArtefactContentFormat;
  contentBody: string;
  updatedAtMs: number;
  updatedByHandle: string | null;
};

type ArtefactContentRow = {
  id: string;
  artefact_id: string;
  room_id: string;
  kind: string;
  content_format: string;
  content_body: string;
  updated_at_ms: number;
  updated_by_handle: string | null;
};

function rowToContent(row: ArtefactContentRow): ArtefactContent {
  return {
    id: row.id,
    artefactId: row.artefact_id,
    roomId: row.room_id,
    kind: row.kind as ArtefactContentKind,
    contentFormat: row.content_format as ArtefactContentFormat,
    contentBody: row.content_body,
    updatedAtMs: row.updated_at_ms,
    updatedByHandle: row.updated_by_handle
  };
}

export function getArtefactContentById(id: string): ArtefactContent | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT id, artefact_id, room_id, kind, content_format, content_body, updated_at_ms, updated_by_handle
         FROM chat_room_artefact_content
        WHERE id = ?`
    )
    .get(id) as ArtefactContentRow | undefined;
  return row ? rowToContent(row) : null;
}

export function getArtefactContentByArtefactId(artefactId: string): ArtefactContent | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT id, artefact_id, room_id, kind, content_format, content_body, updated_at_ms, updated_by_handle
         FROM chat_room_artefact_content
        WHERE artefact_id = ?`
    )
    .get(artefactId) as ArtefactContentRow | undefined;
  return row ? rowToContent(row) : null;
}

export type UpsertArtefactContentInput = {
  id: string;
  artefactId: string;
  roomId: string;
  kind: ArtefactContentKind;
  contentFormat: ArtefactContentFormat;
  contentBody: string;
  updatedByHandle?: string | null;
  nowMs?: number;
};

export function upsertArtefactContent(input: UpsertArtefactContentInput): ArtefactContent {
  const updatedAtMs = input.nowMs ?? Date.now();
  getIdentityDb()
    .prepare(
      `INSERT INTO chat_room_artefact_content
         (id, artefact_id, room_id, kind, content_format, content_body, updated_at_ms, updated_by_handle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content_format = excluded.content_format,
         content_body = excluded.content_body,
         updated_at_ms = excluded.updated_at_ms,
         updated_by_handle = excluded.updated_by_handle`
    )
    .run(
      input.id,
      input.artefactId,
      input.roomId,
      input.kind,
      input.contentFormat,
      input.contentBody,
      updatedAtMs,
      input.updatedByHandle ?? null
    );
  const persisted = getArtefactContentById(input.id);
  if (!persisted) throw new Error('artefact content insert produced no row');
  return persisted;
}

export function resetChatRoomArtefactContentStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM chat_room_artefact_content`).run();
}
