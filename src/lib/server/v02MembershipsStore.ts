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
export type V02MemberKind = 'human' | 'agent';

export type V02MembershipRow = {
  membership_id: string;
  agent_id: string;
  room_id: string;
  role: V02MembershipRole;
  room_alias: string | null;
  joined_at_ms: number;
  left_at_ms: number | null;
  last_read_post_order: number | null;
  // M9d cut-over: per-room presentation mirrored from chat_room_members.
  // All nullable so the legacy chat_room_members rendering fallback
  // (defaultParticipantColor/Icon/BackgroundStyle) still applies when
  // the v0.2 column is unset.
  display_color: string | null;
  display_icon: string | null;
  display_background_style: string | null;
  member_kind: V02MemberKind | null;
  // Per-room display-name override. NULL = inherit agents.display_name
  // (the legacy `chat_room_members.display_name` defaults to the
  // handle, which equals agents.primary_handle — same effective value).
  room_display_name: string | null;
};

export type AddMembershipInput = {
  agent_id: string;
  room_id: string;
  role?: V02MembershipRole;
  room_alias?: string | null;
  // M9d: optional per-room presentation. Pass through from the legacy
  // chat_room_members write so the v0.2 read surfaces match the
  // existing UI without an additional UPDATE call.
  display_color?: string | null;
  display_icon?: string | null;
  display_background_style?: string | null;
  member_kind?: V02MemberKind | null;
  room_display_name?: string | null;
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
  const display_color = input.display_color ?? null;
  const display_icon = input.display_icon ?? null;
  const display_background_style = input.display_background_style ?? null;
  const member_kind = input.member_kind ?? null;
  const room_display_name = input.room_display_name ?? null;
  const now_ms = Date.now();

  const existing = db
    .prepare(
      `SELECT * FROM memberships
        WHERE agent_id = ? AND room_id = ? AND left_at_ms IS NULL
        LIMIT 1`
    )
    .get(input.agent_id, input.room_id) as V02MembershipRow | undefined;

  if (existing) {
    // Idempotent re-add: update role + alias + presentation when supplied.
    // Presentation columns only update when the caller passed a defined
    // value — undefined leaves the existing value intact (avoids clobbering
    // a deliberately set colour on a no-op re-invite).
    const shouldUpdate =
      existing.role !== role ||
      existing.room_alias !== room_alias ||
      (input.display_color !== undefined && existing.display_color !== display_color) ||
      (input.display_icon !== undefined && existing.display_icon !== display_icon) ||
      (input.display_background_style !== undefined &&
        existing.display_background_style !== display_background_style) ||
      (input.member_kind !== undefined && existing.member_kind !== member_kind) ||
      (input.room_display_name !== undefined &&
        existing.room_display_name !== room_display_name);
    if (shouldUpdate) {
      db.prepare(
        `UPDATE memberships
            SET role = ?,
                room_alias = ?,
                display_color = COALESCE(?, display_color),
                display_icon = COALESCE(?, display_icon),
                display_background_style = COALESCE(?, display_background_style),
                member_kind = COALESCE(?, member_kind),
                room_display_name = COALESCE(?, room_display_name)
          WHERE membership_id = ?`
      ).run(
        role,
        room_alias,
        input.display_color === undefined ? null : display_color,
        input.display_icon === undefined ? null : display_icon,
        input.display_background_style === undefined ? null : display_background_style,
        input.member_kind === undefined ? null : member_kind,
        input.room_display_name === undefined ? null : room_display_name,
        existing.membership_id
      );
    }
    return getMembershipById(existing.membership_id) as V02MembershipRow;
  }

  const membership_id = randomUUID();
  db.prepare(
    `INSERT INTO memberships
       (membership_id, agent_id, room_id, role, room_alias, joined_at_ms,
        left_at_ms, last_read_post_order,
        display_color, display_icon, display_background_style, member_kind,
        room_display_name)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`
  ).run(
    membership_id,
    input.agent_id,
    input.room_id,
    role,
    room_alias,
    now_ms,
    display_color,
    display_icon,
    display_background_style,
    member_kind,
    room_display_name
  );
  return getMembershipById(membership_id) as V02MembershipRow;
}

/**
 * M9d: update presentation fields (display_color / display_icon /
 * display_background_style) on an active membership. Mirror target for
 * chatRoomStore.updateRoomMemberPresentation; only writes fields the
 * caller explicitly passed (undefined = no-op).
 *
 * Returns true on row change; false if no active membership row exists.
 */
export function updateMembershipPresentation(input: {
  agent_id: string;
  room_id: string;
  room_display_name?: string | null;
  display_color?: string | null;
  display_icon?: string | null;
  display_background_style?: string | null;
}): boolean {
  const db = getIdentityDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.room_display_name !== undefined) {
    sets.push('room_display_name = ?');
    params.push(input.room_display_name);
  }
  if (input.display_color !== undefined) {
    sets.push('display_color = ?');
    params.push(input.display_color);
  }
  if (input.display_icon !== undefined) {
    sets.push('display_icon = ?');
    params.push(input.display_icon);
  }
  if (input.display_background_style !== undefined) {
    sets.push('display_background_style = ?');
    params.push(input.display_background_style);
  }
  if (sets.length === 0) return false;
  params.push(input.agent_id, input.room_id);
  const info = db
    .prepare(
      `UPDATE memberships
          SET ${sets.join(', ')}
        WHERE agent_id = ? AND room_id = ? AND left_at_ms IS NULL`
    )
    .run(...params);
  return info.changes > 0;
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

/**
 * M9d: hydrated read for chat-room rendering — joins memberships with
 * agents to surface handle + agent display_name alongside the per-room
 * presentation columns. This is the v0.2 replacement for the legacy
 * `SELECT … FROM chat_room_members WHERE room_id = ? ORDER BY joined_at`
 * pattern used by chatRoomStore.loadMembersForRoom.
 *
 * Returns rows in (joined_at_ms ASC) order matching the legacy
 * `ORDER BY joined_at ASC` ordering. Historical rows (left_at_ms IS NOT
 * NULL) are excluded — only the active roster appears.
 *
 * agent_display_name is taken from agents.display_name; per-room display
 * overrides live on membership rows. The membership row_alias takes
 * precedence over agents.primary_handle when surfacing the @-handle.
 *
 * joined_at_iso is derived from joined_at_ms for byte-identical shape
 * with chat_room_members.joined_at (ISO 8601 UTC text).
 */
export type V02RoomMemberRow = {
  membership_id: string;
  agent_id: string;
  room_id: string;
  /** Resolved handle for the read path. Per-room `room_alias` overrides
   *  agents.primary_handle when set. */
  handle: string;
  /** Effective display name for the read path. Per-room override
   *  (`room_display_name`) overrides agents.display_name when set. */
  display_name: string;
  /** Raw agent display_name, surfaced separately for callers that want
   *  the canonical agent label without the per-room override. */
  agent_display_name: string;
  role: V02MembershipRole;
  room_alias: string | null;
  room_display_name: string | null;
  display_color: string | null;
  display_icon: string | null;
  display_background_style: string | null;
  member_kind: V02MemberKind | null;
  joined_at_ms: number;
  joined_at_iso: string;
};

export function listRoomMembersHydrated(room_id: string): V02RoomMemberRow[] {
  const db = getIdentityDb();
  // ORDER BY joined_at_ms ASC matches the legacy chat_room_members
  // `ORDER BY joined_at ASC` ordering. membership_id ASC is the
  // stable tiebreaker for same-millisecond inserts (the legacy table
  // implicitly fell back to ROWID order which mirrors insertion
  // order — UUIDs aren't monotonic but they're stable enough for
  // test determinism and don't reorder across runs).
  const rows = db
    .prepare(
      `SELECT m.membership_id           AS membership_id,
              m.agent_id                AS agent_id,
              m.room_id                 AS room_id,
              COALESCE(m.room_alias, a.primary_handle) AS handle,
              COALESCE(m.room_display_name, a.display_name) AS display_name,
              a.display_name            AS agent_display_name,
              m.role                    AS role,
              m.room_alias              AS room_alias,
              m.room_display_name       AS room_display_name,
              m.display_color           AS display_color,
              m.display_icon            AS display_icon,
              m.display_background_style AS display_background_style,
              m.member_kind             AS member_kind,
              m.joined_at_ms            AS joined_at_ms,
              m.rowid                   AS _rowid
         FROM memberships m
         JOIN agents a ON a.agent_id = m.agent_id
        WHERE m.room_id = ?
          AND m.left_at_ms IS NULL
        ORDER BY m.joined_at_ms ASC, m.rowid ASC`
    )
    .all(room_id) as Array<Omit<V02RoomMemberRow, 'joined_at_iso'> & { _rowid: number }>;
  return rows.map(({ _rowid, ...row }) => {
    void _rowid;
    return {
      ...row,
      joined_at_iso: new Date(row.joined_at_ms).toISOString()
    };
  });
}

/**
 * M9d: cheap presence probe used by the chat-room invite gates to refuse
 * a duplicate add. Replaces the legacy
 *   `SELECT 1 FROM chat_room_members WHERE room_id = ? AND handle = ?`
 * pattern. Resolves @handle via the same precedence as
 * `getActiveMembershipByHandle` (room_alias overrides primary_handle).
 *
 * Returns true when an ACTIVE membership row exists for the resolved
 * (room_id, agent). Historical (left_at_ms IS NOT NULL) rows are
 * excluded — they should not block a re-invite.
 */
export function isHandleActiveMemberOfRoom(room_id: string, handle: string): boolean {
  return getActiveMembershipByHandle(room_id, handle) !== null;
}

/**
 * M9d: humanInboxMembership.sharedContextExists replacement.
 *
 * Returns true when both `handleA` and `handleB` have an active
 * membership in the same non-inbox room (`__inbox_%` prefix excluded
 * to match the legacy query). Inbox rooms are excluded so a stale
 * inbox membership cannot vouch for itself.
 *
 * Resolves each handle via `agents.primary_handle` (the standard
 * agent-layer lookup); legacy SQL keyed on `chat_room_members.handle`
 * directly, but v0.2 keys on `agent_id`.
 */
export function shareActiveNonInboxRoom(handleA: string, handleB: string): boolean {
  const db = getIdentityDb();
  const agentA = v02Agents.getLiveAgentByHandle(handleA);
  if (!agentA) return false;
  const agentB = v02Agents.getLiveAgentByHandle(handleB);
  if (!agentB) return false;
  const row = db
    .prepare(
      `SELECT 1 AS present
         FROM memberships ma
         JOIN memberships mb ON ma.room_id = mb.room_id
        WHERE ma.agent_id = ? AND mb.agent_id = ?
          AND ma.left_at_ms IS NULL AND mb.left_at_ms IS NULL
          AND ma.room_id NOT LIKE '__inbox_%'
        LIMIT 1`
    )
    .get(agentA.agent_id, agentB.agent_id) as { present: number } | undefined;
  return row !== undefined;
}

/**
 * M9d: humanInboxMembership.recomputeInboxEdgesForRoomMembershipChange
 * helper. Returns the (handle, member_kind) tuples for every active
 * member of `room_id`, hydrated from memberships JOIN agents. Used by
 * the inbox-edge recompute to find the OTHER side of each (human,
 * agent) pair without scanning chat_room_members.
 *
 * Replaces `SELECT handle, kind FROM chat_room_members WHERE
 * room_id = ?` with v0.2-native data. member_kind on the row owns
 * 'human'/'agent'; rows pre-dating the column resolve to null and
 * the caller falls back to the legacy heuristic.
 */
export function listActiveMemberHandlesForRoom(
  room_id: string
): Array<{ handle: string; member_kind: V02MemberKind | null }> {
  const db = getIdentityDb();
  return db
    .prepare(
      `SELECT COALESCE(m.room_alias, a.primary_handle) AS handle,
              m.member_kind AS member_kind
         FROM memberships m
         JOIN agents a ON a.agent_id = m.agent_id
        WHERE m.room_id = ? AND m.left_at_ms IS NULL`
    )
    .all(room_id) as Array<{ handle: string; member_kind: V02MemberKind | null }>;
}

/**
 * M9d: humanInboxBackfill replacement — list every distinct human
 * handle that has ever been an active member of a non-inbox room.
 * Resolved by JOIN to agents.primary_handle; member_kind='human'
 * filter matches the legacy chat_room_members.kind='human' filter.
 *
 * Note: rows pre-dating the member_kind ALTER carry NULL — the
 * backfill caller treats NULL as unknown and falls back to legacy
 * data for safety.
 */
export function listDistinctHumanHandles(): string[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT COALESCE(m.room_alias, a.primary_handle) AS handle
         FROM memberships m
         JOIN agents a ON a.agent_id = m.agent_id
        WHERE m.left_at_ms IS NULL
          AND m.member_kind = 'human'
          AND m.room_id NOT LIKE '__inbox_%'`
    )
    .all() as Array<{ handle: string }>;
  return rows.map((row) => row.handle);
}

/**
 * M9d: humanInboxBackfill pairs helper. Returns every distinct
 * (human, agent) pair that share at least one non-inbox room.
 * Resolved via memberships JOIN memberships JOIN agents (×2).
 *
 * Mirrors the legacy `path (a)` half of the backfill UNION; the
 * `path (b)` half (terminal_records.created_by) is unchanged because
 * terminal_records is not a chat_room_members surface.
 */
export function listSharedRoomHumanAgentPairs(): Array<{ human: string; agent: string }> {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT
              COALESCE(mh.room_alias, ah.primary_handle) AS human,
              COALESCE(ma.room_alias, aa.primary_handle) AS agent
         FROM memberships mh
         JOIN memberships ma ON mh.room_id = ma.room_id
         JOIN agents ah ON ah.agent_id = mh.agent_id
         JOIN agents aa ON aa.agent_id = ma.agent_id
        WHERE mh.left_at_ms IS NULL AND ma.left_at_ms IS NULL
          AND mh.member_kind = 'human'
          AND ma.member_kind = 'agent'
          AND mh.room_id NOT LIKE '__inbox_%'`
    )
    .all() as Array<{ human: string; agent: string }>;
  return rows;
}
