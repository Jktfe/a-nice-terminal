/**
 * roomPolicyStore — the two-dimensional room policy (Simplify & Harden,
 * lane A, absorbing the C-logic policy MODEL per the 3-way re-split).
 *
 * Read and Join are SEPARATE axes (conflating them is part of today's mess):
 *   - readPolicy — who may see the room + its history.
 *   - joinPolicy — who may take a handle lease + post.
 * Each axis is one of four states, checked against IDENTITY (never pid):
 *   open    — anyone
 *   allowed — entitled (allowlist / role)   ("permitted" is a synonym)
 *   invite  — explicitly invited
 *   closed  — existing members only; no new
 *
 * Default (no row): join=invite, read=allowed — "watch widely, act narrowly"
 * for the user's own agents (the spec's suggested default).
 *
 * Self-contained table init (answerCapsuleStore pattern) — no db.ts edit.
 */

import { getIdentityDb } from './db';

export type RoomPolicyState = 'open' | 'allowed' | 'invite' | 'closed';

export type RoomPolicy = {
  joinPolicy: RoomPolicyState;
  readPolicy: RoomPolicyState;
};

export const DEFAULT_ROOM_POLICY: RoomPolicy = { joinPolicy: 'invite', readPolicy: 'allowed' };

const VALID_STATES: ReadonlySet<string> = new Set<RoomPolicyState>(['open', 'allowed', 'invite', 'closed']);

type PolicyRow = { room_id: string; join_policy: string; read_policy: string; updated_at_ms: number };

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_policy (
      room_id      TEXT PRIMARY KEY,
      join_policy  TEXT NOT NULL CHECK (join_policy IN ('open','allowed','invite','closed')),
      read_policy  TEXT NOT NULL CHECK (read_policy IN ('open','allowed','invite','closed')),
      updated_at_ms INTEGER NOT NULL
    );
  `);
}

/** The policy for a room. Returns DEFAULT_ROOM_POLICY when none is set — a
 *  room without an explicit policy is invite-to-join, allowed-to-read. */
export function getRoomPolicy(roomId: string, db = getIdentityDb()): RoomPolicy {
  ensureTable(db);
  const row = db.prepare(`SELECT * FROM room_policy WHERE room_id = ?`).get(roomId) as PolicyRow | undefined;
  if (!row) return { ...DEFAULT_ROOM_POLICY };
  return { joinPolicy: row.join_policy as RoomPolicyState, readPolicy: row.read_policy as RoomPolicyState };
}

export type SetRoomPolicyInput = {
  joinPolicy?: RoomPolicyState;
  readPolicy?: RoomPolicyState;
};

/** Set/merge a room's policy. Unspecified axes keep their current value (or
 *  the default if unset). Validates the states. */
export function setRoomPolicy(roomId: string, input: SetRoomPolicyInput, db = getIdentityDb()): RoomPolicy {
  ensureTable(db);
  const current = getRoomPolicy(roomId, db);
  const next: RoomPolicy = {
    joinPolicy: input.joinPolicy ?? current.joinPolicy,
    readPolicy: input.readPolicy ?? current.readPolicy
  };
  if (!VALID_STATES.has(next.joinPolicy)) throw new Error(`setRoomPolicy: invalid joinPolicy '${next.joinPolicy}'`);
  if (!VALID_STATES.has(next.readPolicy)) throw new Error(`setRoomPolicy: invalid readPolicy '${next.readPolicy}'`);
  db.prepare(
    `INSERT INTO room_policy (room_id, join_policy, read_policy, updated_at_ms)
     VALUES (@room_id, @join_policy, @read_policy, @updated_at_ms)
     ON CONFLICT(room_id) DO UPDATE SET
       join_policy = excluded.join_policy,
       read_policy = excluded.read_policy,
       updated_at_ms = excluded.updated_at_ms`
  ).run({ room_id: roomId, join_policy: next.joinPolicy, read_policy: next.readPolicy, updated_at_ms: Date.now() });
  return next;
}
