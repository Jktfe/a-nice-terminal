/**
 * roomBlockStateStore — per-block state that can't be derived from the message
 * stream alone.
 *
 * A "block" is a section of a room's history bounded by context breaks
 * (`system-break` messages). Most of a block is DERIVED (its messages, its
 * bounds) — see roomBlocksStore. But two things are state a block carries on
 * top of its messages, and live here:
 *
 *   1. DELETED — a whole block marked `deleted` is SKIPPED in normal reads /
 *      memory / research / reviews, but its rows are NEVER removed (audit). The
 *      "delete the stupid thing so it doesn't pollute research" case, at block
 *      granularity. (Message-level soft-delete already exists on chat_messages
 *      via deleted_at_ms; this is the block-level equivalent.)
 *   2. SNAPSHOT — the rich state-board "cover" captured when the block was
 *      sealed (the lanes-by-goal board). A break stops being a bare divider and
 *      becomes a legible checkpoint an agent can read at a glance before (or
 *      instead of) deep-reading the block's messages.
 *
 * Keyed by `block_id` = the id of the break message that SEALS the block (the
 * break at its end). The trailing OPEN block (after the last break) is not yet
 * sealed, so it has no row here and cannot be deleted until a break seals it.
 *
 * Self-contained table init (roomPolicyStore pattern); additive, touches no
 * existing table.
 */

import { getIdentityDb } from './db';

export type RoomBlockState = {
  room_id: string;
  /** The sealing break message id. */
  block_id: string;
  deleted_at_ms: number | null;
  deleted_by_handle: string | null;
  /** JSON state-board snapshot captured at seal time; null until authored. */
  snapshot_json: string | null;
};

type RoomBlockStateRow = {
  room_id: string;
  block_id: string;
  deleted_at_ms: number | null;
  deleted_by_handle: string | null;
  snapshot_json: string | null;
};

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_block_state (
      room_id          TEXT NOT NULL,
      block_id         TEXT NOT NULL,
      deleted_at_ms    INTEGER,
      deleted_by_handle TEXT,
      snapshot_json    TEXT,
      PRIMARY KEY (room_id, block_id)
    );
    CREATE INDEX IF NOT EXISTS idx_room_block_state_room ON room_block_state (room_id);
  `);
}

function rowToState(r: RoomBlockStateRow): RoomBlockState {
  return {
    room_id: r.room_id,
    block_id: r.block_id,
    deleted_at_ms: r.deleted_at_ms,
    deleted_by_handle: r.deleted_by_handle,
    snapshot_json: r.snapshot_json
  };
}

/** Upsert the block's delete state. `deleted=false` clears the tombstone
 *  (un-delete) — rows are never physically removed, preserving audit. */
export function setBlockDeleted(
  roomId: string,
  blockId: string,
  deleted: boolean,
  byHandle: string,
  db = getIdentityDb()
): void {
  ensureTable(db);
  const now = deleted ? Date.now() : null;
  const by = deleted ? byHandle : null;
  db.prepare(
    `INSERT INTO room_block_state (room_id, block_id, deleted_at_ms, deleted_by_handle)
     VALUES (@room_id, @block_id, @deleted_at_ms, @deleted_by_handle)
     ON CONFLICT (room_id, block_id) DO UPDATE SET
       deleted_at_ms = excluded.deleted_at_ms,
       deleted_by_handle = excluded.deleted_by_handle`
  ).run({ room_id: roomId, block_id: blockId, deleted_at_ms: now, deleted_by_handle: by });
}

/** Whether the block is currently tombstoned (skip in normal reads). */
export function isBlockDeleted(roomId: string, blockId: string, db = getIdentityDb()): boolean {
  ensureTable(db);
  const row = db
    .prepare(`SELECT deleted_at_ms FROM room_block_state WHERE room_id = ? AND block_id = ?`)
    .get(roomId, blockId) as { deleted_at_ms: number | null } | undefined;
  return row?.deleted_at_ms != null;
}

/** All tombstoned block ids in the room (for the audit / "show deleted" view). */
export function listDeletedBlockIds(roomId: string, db = getIdentityDb()): string[] {
  ensureTable(db);
  return (
    db
      .prepare(`SELECT block_id FROM room_block_state WHERE room_id = ? AND deleted_at_ms IS NOT NULL`)
      .all(roomId) as Array<{ block_id: string }>
  ).map((r) => r.block_id);
}

/** Store the state-board snapshot captured when the block was sealed. */
export function setBlockSnapshot(
  roomId: string,
  blockId: string,
  snapshotJson: string,
  db = getIdentityDb()
): void {
  ensureTable(db);
  db.prepare(
    `INSERT INTO room_block_state (room_id, block_id, snapshot_json)
     VALUES (@room_id, @block_id, @snapshot_json)
     ON CONFLICT (room_id, block_id) DO UPDATE SET snapshot_json = excluded.snapshot_json`
  ).run({ room_id: roomId, block_id: blockId, snapshot_json: snapshotJson });
}

export function getBlockState(roomId: string, blockId: string, db = getIdentityDb()): RoomBlockState | null {
  ensureTable(db);
  const row = db
    .prepare(`SELECT * FROM room_block_state WHERE room_id = ? AND block_id = ?`)
    .get(roomId, blockId) as RoomBlockStateRow | undefined;
  return row ? rowToState(row) : null;
}
