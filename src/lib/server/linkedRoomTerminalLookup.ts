/**
 * linkedRoomTerminalLookup — adapt terminal_records (linked_chat_room_id)
 * into the TerminalRow shape pty-inject-bridge.injectToTerminal expects.
 *
 * Per T2-LINKED-CHAT-T1c (2026-05-14): each terminal_record has 1:1 linked
 * chat room. fanoutMessageToRoomTerminals iterates room_memberships today;
 * this helper adds a SECOND lookup so a posted message to a linked room
 * reaches the terminal pane WITHOUT requiring a memberships row.
 *
 * Only fields injectToTerminal actually reads are populated truthfully:
 *   id, tmux_target_pane, agent_kind, pane_status. Everything else is a
 *   safe default — these adapter rows are NEVER inserted into terminals
 *   table, only synthesised at lookup time.
 */

import { getIdentityDb } from './db';
import type { TerminalRow } from './terminalsStore';

type LinkedRow = {
  session_id: string;
  tmux_target_pane: string | null;
  agent_kind: string | null;
  meta: string | null;
};

function rowToTerminal(r: LinkedRow): TerminalRow {
  return {
    id: r.session_id,
    pid: -1,
    pid_start: null,
    name: r.session_id,
    tmux_target_pane: r.tmux_target_pane,
    agent_kind: r.agent_kind,
    pane_status: 'unknown',
    pane_stale_since: null,
    source: 'terminal-record-linked-room',
    expires_at: null,
    meta: r.meta ?? '{}',
    created_at: 0,
    updated_at: 0
  };
}

export function listLinkedTerminalRowsForRoom(roomId: string): TerminalRow[] {
  const db = getIdentityDb();
  // Pane-binding supersession filter (JWPK msg_wlvguvfvqu/msg_8390722mjh
  // 2026-05-27): a tmux pane recycled across agents must NOT deliver
  // the prior agent's room subscriptions. `superseded_at_ms IS NULL`
  // excludes terminal_records whose pane was claimed by a later row.
  // This is the primary leak surface — Vera (codex --yolo spawn) was
  // PTY-injected with a xenoChat message because the prior @xenocc
  // record on her pane was still being walked here.
  const rows = db.prepare(
    `SELECT tr.session_id, tr.tmux_target_pane, tr.agent_kind, t.meta
       FROM terminal_records tr
       LEFT JOIN terminals t ON t.id = tr.session_id
      WHERE tr.linked_chat_room_id = ?
        AND tr.tmux_target_pane IS NOT NULL
        AND tr.superseded_at_ms IS NULL`
  ).all(roomId) as LinkedRow[];
  return rows.map(rowToTerminal);
}

export function getLinkedTerminalRowBySessionId(sessionId: string): TerminalRow | null {
  const db = getIdentityDb();
  // Supersession filter — see listLinkedTerminalRowsForRoom comment.
  const row = db.prepare(
    `SELECT tr.session_id, tr.tmux_target_pane, tr.agent_kind, t.meta
       FROM terminal_records tr
       LEFT JOIN terminals t ON t.id = tr.session_id
      WHERE tr.session_id = ?
        AND tr.tmux_target_pane IS NOT NULL
        AND tr.superseded_at_ms IS NULL`
  ).get(sessionId) as LinkedRow | undefined;
  return row ? rowToTerminal(row) : null;
}

/**
 * Canonical "is this chat room attached to a terminal" predicate.
 * Used by listing surfaces (Dashboard Recent rooms, /rooms index) to
 * exclude linked chats — they live on the terminal page as one of the
 * three views (RAW / ANT / Chat), not as stand-alone rooms.
 *
 * NOTE: direct lookup-by-id (findChatRoomById, terminal Chat-view fetch)
 * remains unaffected — this is for *listing* surfaces only.
 *
 * 2026-05-27 supersession filter: superseded terminal_records do not
 * count toward "is linked." If the only records pointing at a room are
 * stale pane-bindings from prior agents, the room behaves as a
 * stand-alone room (listed) until a new agent re-registers.
 */
export function isLinkedChatRoom(roomId: string): boolean {
  if (!roomId) return false;
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT 1 AS present FROM terminal_records
        WHERE linked_chat_room_id = ?
          AND superseded_at_ms IS NULL
        LIMIT 1`
    )
    .get(roomId) as { present: number } | undefined;
  return row !== undefined;
}
