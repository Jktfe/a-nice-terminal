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
export function ensureHumanInboxRoom(humanHandle: string): string {
  const trimmed = humanHandle.trim();
  if (trimmed.length === 0) throw new Error('humanHandle cannot be blank.');
  const withAt = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  const roomId = inboxRoomIdFor(withAt);
  const db = getIdentityDb();
  const nowIso = new Date().toISOString();

  const txn = db.transaction(() => {
    // creation_order is UNIQUE so we have to pick a fresh one each time.
    // INSERT OR IGNORE skips when the inbox already exists; if we DID
    // insert, we add the human as the seed member.
    const nextOrderRow = db
      .prepare(`SELECT COALESCE(MAX(creation_order), 0) + 1 AS next FROM chat_rooms`)
      .get() as { next: number };
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
      nextOrderRow.next
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
  return roomId;
}
