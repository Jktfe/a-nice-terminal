/**
 * v02MembershipsStore — single agent×room membership table for v0.2.
 *
 * Schema (see ./db.ts V02_SCHEMA_DDL_STATEMENTS):
 *   memberships(membership_id, agent_id, room_id, role, room_alias?,
 *                   joined_at_ms, left_at_ms?, last_read_post_order?)
 *
 * Replaces TWO legacy tables: `room_memberships` (pidChain-resolved
 * binding + per-room aliases) AND `chat_room_members` (membership
 * projection used by the chat layer). Per the v0.2 spec, both are
 * collapsed into a single source of truth keyed by (agent_id, room_id).
 *
 * Structural invariant (v0.2 spec §Three Structural Invariants #2):
 *
 *   UNIQUE INDEX uq_memberships_agent_room_active
 *     ON memberships (agent_id, room_id) WHERE left_at_ms IS NULL
 *
 * One active membership per (agent × room). Roster duplication is a
 * constraint violation, not silent drift. Historical rows (left_at_ms IS
 * NOT NULL) are preserved for audit + do not participate in the
 * uniqueness check.
 *
 * Crucially this table has NO fanout_target_runtime_id column — fanout
 * target is DERIVED at send time from agents.current_runtime_id.
 * This is THE structural fix for the cached-fanout drift bug that
 * recurred 4× on 2026-05-29. See v0.2 spec §Three Structural
 * Invariants #3.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import * as v02Agents from './v02AgentsStore';

export type V02MembershipRole = 'owner' | 'member' | 'chair' | 'observer' | 'bot';

export type V02MembershipRow = {
  membership_id: string;
  agent_id: string;
  room_id: string;
  role: V02MembershipRole;
  room_alias: string | null;
  joined_at_ms: number;
  left_at_ms: number | null;
  last_read_post_order: number | null;
};

export type AddMembershipInput = {
  agent_id: string;
  room_id: string;
  role?: V02MembershipRole;
  room_alias?: string | null;
};

function normalizeAlias(rawAlias: string | null | undefined): string | null {
  if (rawAlias === null || rawAlias === undefined) return null;
  const trimmed = rawAlias.trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/**
 * Add (or re-activate) an active membership. Idempotent: if an active
 * membership already exists for (agent_id, room_id), updates role/alias
 * in place. If a historical (left_at_ms IS NOT NULL) membership exists,
 * a NEW row is inserted — historical rows preserve audit trail.
 */
export function addMembership(input: AddMembershipInput): V02MembershipRow {
  const db = getIdentityDb();
  const role = input.role ?? 'member';
  const room_alias = normalizeAlias(input.room_alias);
  const now_ms = Date.now();

  const existing = db
    .prepare(
      `SELECT * FROM memberships
        WHERE agent_id = ? AND room_id = ? AND left_at_ms IS NULL
        LIMIT 1`
    )
    .get(input.agent_id, input.room_id) as V02MembershipRow | undefined;

  if (existing) {
    if (existing.role !== role || existing.room_alias !== room_alias) {
      db.prepare(
        `UPDATE memberships
            SET role = ?, room_alias = ?
          WHERE membership_id = ?`
      ).run(role, room_alias, existing.membership_id);
    }
    return getMembershipById(existing.membership_id) as V02MembershipRow;
  }

  const membership_id = randomUUID();
  db.prepare(
    `INSERT INTO memberships
       (membership_id, agent_id, room_id, role, room_alias, joined_at_ms,
        left_at_ms, last_read_post_order)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).run(membership_id, input.agent_id, input.room_id, role, room_alias, now_ms);
  return getMembershipById(membership_id) as V02MembershipRow;
}

export function getMembershipById(membership_id: string): V02MembershipRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM memberships WHERE membership_id = ?`)
    .get(membership_id) as V02MembershipRow | undefined;
  return row ?? null;
}

/**
 * Soft-remove an active membership by flipping left_at_ms. Idempotent
 * no-op if there's no active row. Returns true if a flip happened.
 */
export function removeMembership(agent_id: string, room_id: string): boolean {
  const db = getIdentityDb();
  const now_ms = Date.now();
  const info = db
    .prepare(
      `UPDATE memberships
          SET left_at_ms = ?
        WHERE agent_id = ? AND room_id = ? AND left_at_ms IS NULL`
    )
    .run(now_ms, agent_id, room_id);
  return info.changes > 0;
}

/**
 * Active memberships only — historical rows excluded. Use for fanout +
 * roster + auth gates.
 */
export function listActiveMembershipsForRoom(room_id: string): V02MembershipRow[] {
  const db = getIdentityDb();
  return db
    .prepare(
      `SELECT * FROM memberships
        WHERE room_id = ? AND left_at_ms IS NULL
        ORDER BY joined_at_ms ASC`
    )
    .all(room_id) as V02MembershipRow[];
}

/**
 * All memberships including historical. Use only for audit surfaces.
 */
export function listAllMembershipsForRoomIncludingHistorical(
  room_id: string
): V02MembershipRow[] {
  const db = getIdentityDb();
  return db
    .prepare(
      `SELECT * FROM memberships
        WHERE room_id = ?
        ORDER BY joined_at_ms ASC`
    )
    .all(room_id) as V02MembershipRow[];
}

export function listActiveMembershipsForAgent(agent_id: string): V02MembershipRow[] {
  const db = getIdentityDb();
  return db
    .prepare(
      `SELECT * FROM memberships
        WHERE agent_id = ? AND left_at_ms IS NULL
        ORDER BY joined_at_ms ASC`
    )
    .all(agent_id) as V02MembershipRow[];
}

/**
 * Resolve (room_id, agent_id) → active membership row. Returns null when
 * the agent has no active membership in the room.
 */
export function getActiveMembership(
  room_id: string,
  agent_id: string
): V02MembershipRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT * FROM memberships
        WHERE room_id = ? AND agent_id = ? AND left_at_ms IS NULL
        LIMIT 1`
    )
    .get(room_id, agent_id) as V02MembershipRow | undefined;
  return row ?? null;
}

/**
 * Update last_read_post_order. Idempotent; clamps to monotonically
 * non-decreasing (a lower seq is ignored — protects against out-of-
 * order writes from racing clients).
 */
export function setLastReadPostOrder(
  membership_id: string,
  post_order: number
): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(
      `UPDATE memberships
          SET last_read_post_order = ?
        WHERE membership_id = ?
          AND (last_read_post_order IS NULL OR last_read_post_order < ?)`
    )
    .run(post_order, membership_id, post_order);
  return info.changes > 0;
}

/**
 * DERIVED fanout target lookup — the structural-invariant query.
 *
 * Returns the live runtime_id for each active member of the room, by
 * joining memberships → agents.current_runtime_id at READ time. No
 * cached column. If an agent has no current runtime (NULL pointer), they
 * appear in the result with target=null — caller decides whether to
 * notify-only or skip.
 *
 * This is THE query the fanout layer should call at send time. See v0.2
 * spec §The TigerResearch Recovery Flow for why this is derived not
 * cached.
 */
export function listFanoutTargetsForRoom(
  room_id: string
): { agent_id: string; runtime_id: string | null; room_alias: string | null }[] {
  const db = getIdentityDb();
  return db
    .prepare(
      `SELECT m.agent_id    AS agent_id,
              a.current_runtime_id AS runtime_id,
              m.room_alias  AS room_alias
         FROM memberships m
         JOIN agents a ON a.agent_id = m.agent_id
        WHERE m.room_id = ?
          AND m.left_at_ms IS NULL
          AND a.status = 'live'
        ORDER BY m.joined_at_ms ASC`
    )
    .all(room_id) as {
    agent_id: string;
    runtime_id: string | null;
    room_alias: string | null;
  }[];
}

/**
 * Resolve a handle within a room context. Walks agents.primary_handle
 * (canonical) + memberships.room_alias (per-room override). Used by
 * the auth gate + the @-mention parser.
 *
 * Returns the active membership row whose agent.primary_handle OR
 * membership.room_alias matches the handle (normalised with leading @).
 *
 * Mirrors the legacy `roomMembershipsStore.getTerminalIdByHandle` shape
 * but resolves at the agent layer (durable) not the runtime layer
 * (ephemeral). Callers needing the live runtime_id should then call
 * `v02RuntimesStore.getLiveRuntimeForAgent(row.agent_id)`.
 */
export function getActiveMembershipByHandle(
  room_id: string,
  handle: string
): V02MembershipRow | null {
  const db = getIdentityDb();
  const trimmed = handle.trim();
  if (trimmed.length === 0) return null;
  const normalised = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  // 1. Per-room alias takes precedence (it's a deliberate user choice).
  const aliasRow = db
    .prepare(
      `SELECT * FROM memberships
        WHERE room_id = ? AND room_alias = ? AND left_at_ms IS NULL
        LIMIT 1`
    )
    .get(room_id, normalised) as V02MembershipRow | undefined;
  if (aliasRow) return aliasRow;
  // 2. Fall through to the agent's primary_handle.
  const agent = v02Agents.getLiveAgentByHandle(normalised);
  if (!agent) return null;
  return getActiveMembership(room_id, agent.agent_id);
}
