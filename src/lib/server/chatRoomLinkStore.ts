/**
 * Persisted store for room-to-room links (Task #49 v3 parity).
 *
 * A link is a directed edge from a source room to a target room with a
 * relationship label. UNIQUE on (source, target, relationship) at the
 * schema level prevents duplicate edges; createLink throws a clear error
 * when the constraint trips so the HTTP layer can return 409.
 *
 * The store is intentionally thin — read paths return the joined room
 * name so the UI does not need a separate fetch per link.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export const ROOM_LINK_RELATIONSHIPS = [
  'discussion_of',
  'promoted_summary_for',
  'spawned_from',
  'follows_up'
] as const;

export type RoomLinkRelationship = (typeof ROOM_LINK_RELATIONSHIPS)[number];

export type RoomLink = {
  id: string;
  sourceRoomId: string;
  targetRoomId: string;
  relationship: RoomLinkRelationship;
  title: string | null;
  createdBy: string | null;
  createdAtMs: number;
};

export type RoomLinkWithPeer = RoomLink & {
  peerRoomId: string;
  peerRoomName: string;
};

type RoomLinkRow = {
  id: string;
  source_room_id: string;
  target_room_id: string;
  relationship: string;
  title: string | null;
  created_by: string | null;
  created_at_ms: number;
};

type RoomLinkWithPeerRow = RoomLinkRow & {
  peer_room_id: string;
  peer_room_name: string;
};

export class DuplicateRoomLinkError extends Error {
  constructor() {
    super('A link with this source, target, and relationship already exists.');
    this.name = 'DuplicateRoomLinkError';
  }
}

function rowToLink(row: RoomLinkRow): RoomLink {
  return {
    id: row.id,
    sourceRoomId: row.source_room_id,
    targetRoomId: row.target_room_id,
    relationship: row.relationship as RoomLinkRelationship,
    title: row.title,
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms
  };
}

function rowToLinkWithPeer(row: RoomLinkWithPeerRow): RoomLinkWithPeer {
  return { ...rowToLink(row), peerRoomId: row.peer_room_id, peerRoomName: row.peer_room_name };
}

export function createRoomLink(input: {
  sourceRoomId: string;
  targetRoomId: string;
  relationship: RoomLinkRelationship;
  title: string | null;
  createdBy: string | null;
  nowMs?: number;
}): RoomLink {
  const db = getIdentityDb();
  const id = randomUUID();
  const createdAtMs = input.nowMs ?? Date.now();
  try {
    db.prepare(
      `INSERT INTO chat_room_links
       (id, source_room_id, target_room_id, relationship, title, created_by, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.sourceRoomId,
      input.targetRoomId,
      input.relationship,
      input.title,
      input.createdBy,
      createdAtMs
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('UNIQUE')) throw new DuplicateRoomLinkError();
    throw cause;
  }
  return {
    id,
    sourceRoomId: input.sourceRoomId,
    targetRoomId: input.targetRoomId,
    relationship: input.relationship,
    title: input.title,
    createdBy: input.createdBy,
    createdAtMs
  };
}

export function listOutgoingRoomLinks(sourceRoomId: string): RoomLinkWithPeer[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT chat_room_links.*,
              chat_rooms.id   AS peer_room_id,
              chat_rooms.name AS peer_room_name
         FROM chat_room_links
         JOIN chat_rooms ON chat_rooms.id = chat_room_links.target_room_id
        WHERE chat_room_links.source_room_id = ?
          AND chat_rooms.deleted_at_ms IS NULL
        ORDER BY chat_room_links.created_at_ms DESC`
    )
    .all(sourceRoomId) as RoomLinkWithPeerRow[];
  return rows.map(rowToLinkWithPeer);
}

export function listIncomingRoomLinks(targetRoomId: string): RoomLinkWithPeer[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT chat_room_links.*,
              chat_rooms.id   AS peer_room_id,
              chat_rooms.name AS peer_room_name
         FROM chat_room_links
         JOIN chat_rooms ON chat_rooms.id = chat_room_links.source_room_id
        WHERE chat_room_links.target_room_id = ?
          AND chat_rooms.deleted_at_ms IS NULL
        ORDER BY chat_room_links.created_at_ms DESC`
    )
    .all(targetRoomId) as RoomLinkWithPeerRow[];
  return rows.map(rowToLinkWithPeer);
}

export function deleteRoomLink(linkId: string): boolean {
  const result = getIdentityDb()
    .prepare(`DELETE FROM chat_room_links WHERE id = ?`)
    .run(linkId);
  return result.changes > 0;
}

export function resetChatRoomLinkStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM chat_room_links`).run();
}
