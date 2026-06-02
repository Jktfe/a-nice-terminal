/**
 * terminalLinkedChatReconciler — enforces the invariant JWPK named
 * (msg_z1fc79412i): "all live terminals should have a live linked chat".
 *
 * Lane A / A6. Root of the invite-picker bug: a 2026-05-29 batch-archive
 * archived ~80 rooms including the per-terminal "Terminal: X" linked-chat
 * rooms — but their terminals stayed LIVE. listLiveTerminalRecords correctly
 * excludes records whose linked room is archived, so those live terminals
 * (homebrew*, antios*, …) vanished from the picker. The picker filter is
 * RIGHT; the invariant was BROKEN.
 *
 * The fix is to RESTORE the invariant, not loosen the picker: for any live,
 * non-superseded terminal whose linked chat room is archived (but not
 * deleted), un-archive that room. The live terminal regains a live linked
 * chat and reappears in the picker by construction. Deleted rooms are left
 * alone (a hard delete is a deliberate teardown, not drift).
 */

import { getIdentityDb } from './db';

export type ReconciledLink = {
  sessionId: string;
  roomId: string;
  roomName: string;
};

type Row = { session_id: string; linked_chat_room_id: string; name: string };

/**
 * Un-archive the linked chat room of every live, non-superseded terminal
 * whose link points at an archived (not deleted) room. Returns what was
 * restored — safe to run repeatedly (idempotent: already-live links are not
 * matched). Intended to run on register + a low-frequency sweep so the
 * invariant self-heals rather than silently hiding live agents.
 */
export function reconcileLiveTerminalLinkedChats(db = getIdentityDb()): ReconciledLink[] {
  const violations = db
    .prepare(
      `SELECT tr.session_id AS session_id,
              tr.linked_chat_room_id AS linked_chat_room_id,
              cr.name AS name
         FROM terminal_records tr
         JOIN chat_rooms cr ON tr.linked_chat_room_id = cr.id
         LEFT JOIN terminals t ON tr.session_id = t.id
        WHERE tr.superseded_at_ms IS NULL
          AND (t.status IS NULL OR t.status = 'live')
          AND cr.archived_at_ms IS NOT NULL
          AND cr.deleted_at_ms IS NULL`
    )
    .all() as Row[];

  if (violations.length === 0) return [];

  const unarchive = db.prepare(`UPDATE chat_rooms SET archived_at_ms = NULL WHERE id = ?`);
  const restored: ReconciledLink[] = [];
  const tx = db.transaction((rows: Row[]) => {
    for (const r of rows) {
      unarchive.run(r.linked_chat_room_id);
      restored.push({ sessionId: r.session_id, roomId: r.linked_chat_room_id, roomName: r.name });
    }
  });
  tx(violations);
  return restored;
}

/** Report-only: which live terminals currently violate the invariant
 *  (linked chat archived), WITHOUT mutating. For surfacing/observability. */
export function findLiveTerminalLinkedChatViolations(db = getIdentityDb()): ReconciledLink[] {
  const rows = db
    .prepare(
      `SELECT tr.session_id AS session_id,
              tr.linked_chat_room_id AS linked_chat_room_id,
              cr.name AS name
         FROM terminal_records tr
         JOIN chat_rooms cr ON tr.linked_chat_room_id = cr.id
         LEFT JOIN terminals t ON tr.session_id = t.id
        WHERE tr.superseded_at_ms IS NULL
          AND (t.status IS NULL OR t.status = 'live')
          AND cr.archived_at_ms IS NOT NULL
          AND cr.deleted_at_ms IS NULL`
    )
    .all() as Row[];
  return rows.map((r) => ({ sessionId: r.session_id, roomId: r.linked_chat_room_id, roomName: r.name }));
}
