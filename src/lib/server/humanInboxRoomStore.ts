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

import { getIdentityDb } from './db';
import { durableMemberWhereClause } from './membershipStore';

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
  const hasCleanMembership = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room_membership'`)
    .get();
  if (!hasCleanMembership) return [];
  const rows = db.prepare(
    `SELECT DISTINCT room_id AS room_id
       FROM room_membership
      WHERE handle = ?
        AND ${durableMemberWhereClause()}
        AND room_id LIKE '__inbox_%'`
  ).all(handle) as Array<{ room_id: string }>;
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
  // JWPK cleanup 2026-06-03: hidden per-human inbox rooms are retired.
  // Keep the deterministic id return for callers that use it for broadcasts,
  // but do not create chat_rooms / membership rows.
  return roomId;
}
