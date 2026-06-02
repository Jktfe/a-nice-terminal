/**
 * roomHealthStore — ROOM-HEALTH read-model (workstream C, plan
 * room-identity-stage-full-delivery-2026-06-02, owned by @v4claude).
 *
 * Pure, READ-ONLY projection of the core room-identity invariant chain for
 * every LIVE terminal, so identity drift is DETECTED here (a green/amber/red
 * list) BEFORE a human hits a 403 on chat.post / chat.read.
 *
 * "Live terminal" = a terminal_records row whose pane is current
 * (superseded_at_ms IS NULL) AND whose backing terminals row is alive
 * (terminals.status='live'). Recycled panes (superseded) + archived/deleted
 * terminals are excluded — they cannot transact, so their broken links are
 * not actionable noise.
 *
 * The invariant chain checked per live terminal:
 *   1. hasHandle      — terminal_records.handle is a non-empty string. Without
 *                       a handle the chat.post gate cannot resolve the caller
 *                       (the orphan-auto-pane null-handle bug class).
 *   2. isMember       — at least one NON-revoked room_membership references the
 *                       terminal. A handled terminal that belongs to no room
 *                       can authenticate but reaches nothing.
 *   3. linkedRoomLive — linked_chat_room_id is NULL (no 1:1 linked room, fine)
 *                       OR it points at a chat_rooms row that exists and is
 *                       neither archived nor deleted. A dangling pointer means
 *                       the terminal's Chat view 404s / mis-routes.
 *
 *   healthy = hasHandle AND isMember AND linkedRoomLive.
 *
 * brokenReason picks the single most-actionable failure, in priority order:
 *   no-handle > dangling-linked-room > no-membership.
 * (A missing handle is the root cause; a dangling linked room is a concrete
 * mis-wire to fix; a missing membership is the softest "just invite it" case.)
 *
 * INVARIANTS OF THIS MODULE:
 *   - SELECT-only. It NEVER writes to terminals / terminal_records /
 *     room_memberships / chat_rooms or any identity table. It only reports.
 *   - It does not own or duplicate the identity resolver, leases, rebind, or
 *     the auth gates (workstream A). It reads the same tables they enforce on
 *     and surfaces the contract for human eyes.
 */

import { getIdentityDb } from './db';

export type RoomHealthBrokenReason =
  | 'no-handle'
  | 'no-membership'
  | 'dangling-linked-room';

export interface RoomHealthEntry {
  /** Best display label: the handle if present, else the terminal_records name. */
  name: string;
  /** terminal_records.handle, or null when absent/blank. */
  handle: string | null;
  /** terminal_records.session_id (== terminals.id). */
  terminalId: string;
  hasHandle: boolean;
  isMember: boolean;
  linkedRoomLive: boolean;
  healthy: boolean;
  /** null when healthy; otherwise the single most-actionable failure. */
  brokenReason: RoomHealthBrokenReason | null;
}

export interface RoomHealthSummary {
  total: number;
  healthy: number;
  broken: number;
}

type HealthRow = {
  session_id: string;
  record_name: string;
  handle: string | null;
  linked_chat_room_id: string | null;
  /** 1 when >=1 non-revoked room_membership references the terminal. */
  member_count: number;
  /** linked_chat_room_id is NULL → 1 (vacuously live). */
  linked_is_null: number;
  /** 1 when the linked room exists AND is not archived AND not deleted. */
  linked_live: number;
};

/**
 * Read-only projection of the identity invariant chain for every live terminal.
 * Returns one entry per live terminal, ordered by session_id for stability.
 */
export function listRoomHealth(): RoomHealthEntry[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT
          tr.session_id          AS session_id,
          tr.name                AS record_name,
          tr.handle              AS handle,
          tr.linked_chat_room_id AS linked_chat_room_id,
          (
            SELECT COUNT(1) FROM room_memberships rm
             WHERE rm.terminal_id = tr.session_id
               AND rm.revoked_at_ms IS NULL
          ) AS member_count,
          CASE WHEN tr.linked_chat_room_id IS NULL THEN 1 ELSE 0 END AS linked_is_null,
          CASE
            WHEN tr.linked_chat_room_id IS NULL THEN 0
            WHEN EXISTS (
              SELECT 1 FROM chat_rooms cr
               WHERE cr.id = tr.linked_chat_room_id
                 AND cr.archived_at_ms IS NULL
                 AND cr.deleted_at_ms IS NULL
            ) THEN 1
            ELSE 0
          END AS linked_live
        FROM terminal_records tr
        JOIN terminals t ON t.id = tr.session_id
       WHERE tr.superseded_at_ms IS NULL
         AND t.status = 'live'
       ORDER BY tr.session_id ASC`
    )
    .all() as HealthRow[];

  return rows.map((row) => {
    const hasHandle = typeof row.handle === 'string' && row.handle.trim().length > 0;
    const isMember = row.member_count > 0;
    const linkedRoomLive = row.linked_is_null === 1 || row.linked_live === 1;
    const healthy = hasHandle && isMember && linkedRoomLive;

    let brokenReason: RoomHealthBrokenReason | null = null;
    if (!healthy) {
      if (!hasHandle) brokenReason = 'no-handle';
      else if (!linkedRoomLive) brokenReason = 'dangling-linked-room';
      else brokenReason = 'no-membership';
    }

    return {
      name: hasHandle ? (row.handle as string) : row.record_name,
      handle: hasHandle ? (row.handle as string) : null,
      terminalId: row.session_id,
      hasHandle,
      isMember,
      linkedRoomLive,
      healthy,
      brokenReason
    } satisfies RoomHealthEntry;
  });
}

/** Aggregate counts over the per-terminal health list. */
export function summariseRoomHealth(entries: RoomHealthEntry[]): RoomHealthSummary {
  const healthy = entries.filter((e) => e.healthy).length;
  return {
    total: entries.length,
    healthy,
    broken: entries.length - healthy
  };
}
