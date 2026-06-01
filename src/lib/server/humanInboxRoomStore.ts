/**
 * Per-human inbox rooms (JWPK 2026-05-22).
 *
 * Every human handle the system has ever interacted with gets exactly ONE
 * hidden chat room `__inbox_<slug>__` that they own and whose membership
 * is the set of "agents that have permission to ask this human directly".
 *
 * The inbox room stores NO ask messages — asks live in their originating
 * room. The inbox room is a pure auth + broadcast carrier:
 *
 *   - Auth gate: "is the caller a member of __inbox_<askee>__?" gates
 *     reading the askee's asks + opening new asks targeting them.
 *   - Broadcast channel: askAdded / askResolved events are mirrored into
 *     the inbox room so the inbox UI updates in real-time without
 *     polling.
 *   - Future home for the premium native-app Chair UI.
 *
 * Membership is computed elsewhere (humanInboxMembership.ts). This file
 * is just the provisioning + filter surface.
 *
 * Room id is DETERMINISTIC (`__inbox_<slug>__`) so ensureHumanInboxRoom is
 * a safe upsert called from many call sites (humans joining their first
 * chat room, terminal_records.created_by being set, etc.) without risking
 * duplicate inbox rooms per handle.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import {
  mirrorAddMembership as v02MirrorAddMembership,
  ensureV02RoomExists as v02EnsureRoomExists
} from './v02ChatRoomBridge';

const INBOX_ID_PREFIX = '__inbox_';
const INBOX_ID_SUFFIX = '__';

/** Pattern used by listChatRooms() filters + tests to identify inbox rooms. */
export const INBOX_ROOM_ID_PATTERN = /^__inbox_[a-z0-9_-]+__$/;

/** Turn a global handle (with or without @) into its inbox room id. */
export function inboxRoomIdFor(humanHandle: string): string {
  const trimmed = humanHandle.trim();
  const noAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const slug = noAt.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return `${INBOX_ID_PREFIX}${slug}${INBOX_ID_SUFFIX}`;
}

export function isInboxRoomId(roomId: string): boolean {
  return INBOX_ROOM_ID_PATTERN.test(roomId);
}

/**
 * Idempotent: create the inbox room for `humanHandle` and add the human as
 * its sole initial member. Returns the inbox room id either way.
 *
 * Safe to call from multiple sites (membership hooks, backfill, manual
 * registration) — the deterministic id + INSERT OR IGNORE on the room AND
 * the member row mean races collapse to no-ops.
 */
/**
 * For a given handle (human or agent), return every human whose inbox the
 * handle is a member of. Used by the /api/asks auth gate to decide which
 * askees' asks the caller can see.
 *
 * A human is always in their own inbox so this returns [self] for humans
 * regardless of other state.
 */
export function listInboxOwnersWhereHandleIsMember(handle: string): string[] {
  const db = getIdentityDb();
  // M9d cut-over phase 3: read v0.2 memberships scoped to inbox rooms
  // (`room_id LIKE '__inbox_%'`). Both surfaces dual-written via the
  // bridge so the result is identical; v0.2 is the new source of
  // truth. The handle may match a per-room alias (room_alias column)
  // or the agent's canonical primary_handle — both are checked via
  // the JOIN below.
  const rows = db.prepare(
    `SELECT DISTINCT m.room_id AS room_id
       FROM memberships m
       JOIN agents a ON a.agent_id = m.agent_id
      WHERE (m.room_alias = ? OR a.primary_handle = ?)
        AND m.left_at_ms IS NULL
        AND m.room_id LIKE '__inbox_%'`
  ).all(handle, handle) as Array<{ room_id: string }>;
  const owners: string[] = [];
  for (const row of rows) {
    // __inbox_<slug>__ → @<slug>. Slugs lowercase, no @; reconstruct
    // by stripping prefix/suffix and prepending @.
    const slug = row.room_id.slice('__inbox_'.length, -'__'.length);
    if (slug.length > 0) owners.push(`@${slug}`);
  }
  return owners;
}

export function ensureHumanInboxRoom(humanHandle: string): string {
  const trimmed = humanHandle.trim();
  if (trimmed.length === 0) throw new Error('humanHandle cannot be blank.');
  const withAt = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  const roomId = inboxRoomIdFor(withAt);
  const db = getIdentityDb();
  const nowIso = new Date().toISOString();

  const txn = db.transaction(() => {
    // creation_order is UNIQUE INTEGER NOT NULL. Inbox rooms shouldn't
    // consume positive-space creation_order slots — that bumps the
    // numbering of normal rooms and breaks listChatRooms ordering tests
    // that assert [1,2,3] for three newly-created rooms. Use the
    // NEGATIVE half of the integer line: monotonically decreasing
    // (-1, -2, -3, ...) by walking down from the current minimum.
    // listChatRooms filters __inbox_* by id pattern so the negative
    // creation_order is invisible to that surface.
    const minOrderRow = db
      .prepare(`SELECT COALESCE(MIN(creation_order), 0) AS min FROM chat_rooms WHERE id LIKE '__inbox_%'`)
      .get() as { min: number };
    const inboxOrder = Math.min(0, minOrderRow.min) - 1;
    const result = db.prepare(`INSERT OR IGNORE INTO chat_rooms
      (id, name, summary, attention_state, last_update,
       when_it_was_created, who_created_it, creation_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      roomId,
      `Inbox: ${withAt}`,
      `Hidden per-human ask inbox for ${withAt}. Membership is auto-computed; do not edit directly.`,
      'ready',
      nowIso,
      nowIso,
      withAt,
      inboxOrder
    );
    if (result.changes > 0) {
      db.prepare(`INSERT OR IGNORE INTO chat_room_members
        (id, room_id, handle, display_name, display_color, display_icon,
         display_background_style, joined_at, kind)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human')`).run(
        randomUUID(), roomId, withAt, withAt, '#DC2626',
        withAt.slice(1, 2).toUpperCase() || '?', 'card', nowIso
      );
    }
  });
  txn();
  // M9c dual-write + M9d presentation thread-through: mirror the
  // inbox room + the human owner membership into v0.2 substrate so
  // the v0.2 read path reproduces the same self-membership row.
  // Outside the legacy transaction because the bridge helpers swallow
  // errors and we don't want a v02 failure to roll back the legacy
  // inbox provisioning.
  v02EnsureRoomExists(roomId);
  v02MirrorAddMembership({
    roomId,
    handle: withAt,
    displayName: withAt,
    role: 'owner',
    memberKind: 'human',
    roomDisplayName: withAt,
    displayColor: '#DC2626',
    displayIcon: withAt.slice(1, 2).toUpperCase() || '?',
    displayBackgroundStyle: 'card'
  });
  return roomId;
}
