/**
 * roomMembershipsStore — per-room handle aliases per PTY-INJECT-0 v2 doc Q3.
 *
 * Schema (see ./db.ts):
 *   room_memberships(id, room_id, handle, terminal_id, created_at)
 *   UNIQUE(room_id, handle)
 *
 * Concept: a terminal entity (terminals row) can join multiple rooms with a
 * different handle in each. e.g. terminal "claude2-overnight" might be
 * "@claude2" in ant-build and "@gardener" in ant-evolve. Handles are
 * room-scoped here, not global.
 *
 * In A-scope: addMembership + getRoomScopedHandle round-trip. The
 * downstream room-to-handle-to-terminal resolution lives in
 * /api/identity/resolve handler; this store just stores rows.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import { postSystemMessage } from './chatMessageStore';
import { resolveHumanOwnership } from './consentGate';

// β3 (JWPK msg_fuvbzkd4wx 2026-05-23): on first agent join into a room, post
// a one-time system message stating the context-break + memory rules. Skips
// human handles (who already know the rules) and skips on existing-row
// re-bind (the message is per-(room, agent) first-time only).
const AGENT_JOIN_PREAMBLE_BODY = [
  '**Agent join — context discipline for this room** (one-time system notice).',
  '',
  '1. `kind=system-break` messages are a HARD backwards-scan boundary. Don\'t read older context unless explicitly asked.',
  '2. Memory files (`room-memories/<memoryID>.md`) are room-only by default — only pull if linked from recent room posts or @you asks.',
  '',
  'Use the ask primitive for real decisions. Tight ACKs for coordination. Surface obstacles as 2-4 logic-shape paths, never bulk-dump.',
].join('\n');

export type RoomMembershipRow = {
  id: string;
  room_id: string;
  handle: string;
  terminal_id: string;
  created_at: number;
};

export type AddMembershipInput = {
  room_id: string;
  handle: string;
  terminal_id: string;
};

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export function addMembership(input: AddMembershipInput): RoomMembershipRow {
  const db = getIdentityDb();
  const handle = normalizeHandle(input.handle);
  const now = currentUnixSeconds();

  const existing = db
    .prepare(`SELECT * FROM room_memberships WHERE room_id = ? AND handle = ? AND revoked_at_ms IS NULL`)
    .get(input.room_id, handle) as RoomMembershipRow | undefined;

  if (existing) {
    if (existing.terminal_id !== input.terminal_id) {
      db.prepare(`UPDATE room_memberships SET terminal_id = ? WHERE id = ?`).run(
        input.terminal_id, existing.id
      );
      return { ...existing, terminal_id: input.terminal_id };
    }
    return existing;
  }

  const newId = randomUUID();
  db.prepare(`INSERT INTO room_memberships
    (id, room_id, handle, terminal_id, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(
    newId, input.room_id, handle, input.terminal_id, now
  );

  // β3 agent-join preamble. Best-effort; never block the membership insert.
  try {
    maybePostAgentJoinPreamble(input.room_id, handle);
  } catch {
    /* Posting the preamble is non-critical — swallow errors so a system-
       message failure can't break room join. */
  }

  return {
    id: newId,
    room_id: input.room_id,
    handle,
    terminal_id: input.terminal_id,
    created_at: now
  };
}

function maybePostAgentJoinPreamble(roomId: string, handle: string): void {
  const ownership = resolveHumanOwnership(handle);
  if (ownership.kind !== 'agent') return;
  postSystemMessage({ roomId, body: AGENT_JOIN_PREAMBLE_BODY });
}

export function getRoomScopedHandle(roomId: string, terminalId: string): string | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT handle FROM room_memberships WHERE room_id = ? AND terminal_id = ? AND revoked_at_ms IS NULL`)
    .get(roomId, terminalId) as { handle: string } | undefined;
  return row?.handle ?? null;
}

export function getTerminalIdByHandle(roomId: string, handle: string): string | null {
  const db = getIdentityDb();
  const normalised = normalizeHandle(handle);
  const row = db
    .prepare(`SELECT terminal_id FROM room_memberships WHERE room_id = ? AND handle = ? AND revoked_at_ms IS NULL`)
    .get(roomId, normalised) as { terminal_id: string } | undefined;
  return row?.terminal_id ?? null;
}

// Default-safe: active memberships only. revoked_at_ms IS NULL filter
// prevents revoked remote-mappings from leaking into fanout/identity-gate/
// audit/status consumers per the M4 T1.1 cross-slice fix.
export function listMembershipsForRoom(roomId: string): RoomMembershipRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM room_memberships WHERE room_id = ? AND revoked_at_ms IS NULL ORDER BY created_at ASC`)
    .all(roomId) as RoomMembershipRow[];
}

// Audit variant: includes revoked rows. Use only for audit-permissions
// or other surfaces that explicitly need the historical trail.
export function listAllMembershipsForRoomIncludingRevoked(roomId: string): RoomMembershipRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM room_memberships WHERE room_id = ? ORDER BY created_at ASC`)
    .all(roomId) as RoomMembershipRow[];
}

export function listMembershipsForTerminal(terminalId: string): RoomMembershipRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM room_memberships WHERE terminal_id = ? AND revoked_at_ms IS NULL ORDER BY created_at ASC`)
    .all(terminalId) as RoomMembershipRow[];
}

/**
 * Row returned by listChatRoomsForTerminal — one per chat room the terminal
 * participates in (via room_memberships) or chairs (via chat_rooms
 * .current_chair_handle matched against a membership.handle).
 *
 * `role` is 'chair' when the terminal's per-room handle matches
 * chat_rooms.current_chair_handle, otherwise 'member'. Linked chats are
 * filtered out — they live on the terminal page, not in the "chatrooms"
 * surface, matching the LINKED-CHAT-LISTING-FILTER policy in chatRoomStore.
 */
export type ChatRoomForTerminalRow = {
  id: string;
  name: string;
  role: 'chair' | 'member';
};

export function listChatRoomsForTerminal(terminalId: string): ChatRoomForTerminalRow[] {
  const db = getIdentityDb();
  // Pull active memberships joined to live chat_rooms (excluding soft-deleted
  // and archived). Excludes any room that is the intrinsic linked chat of a
  // terminal_records row, since linked chats are surfaced separately.
  const rows = db
    .prepare(`SELECT cr.id AS id, cr.name AS name, cr.current_chair_handle AS chair,
                     rm.handle AS handle
              FROM room_memberships rm
              INNER JOIN chat_rooms cr ON cr.id = rm.room_id
              WHERE rm.terminal_id = ?
                AND rm.revoked_at_ms IS NULL
                AND cr.deleted_at_ms IS NULL
                AND cr.archived_at_ms IS NULL
                AND cr.id NOT IN (
                  -- Pane-binding supersession (JWPK 2026-05-27): only
                  -- LIVE terminal_records count as "this room is
                  -- linked." Stale pane-bindings should not hide a
                  -- room from the standalone list.
                  SELECT linked_chat_room_id FROM terminal_records
                  WHERE linked_chat_room_id IS NOT NULL
                    AND superseded_at_ms IS NULL
                )
              ORDER BY cr.creation_order DESC`)
    .all(terminalId) as { id: string; name: string; chair: string | null; handle: string }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.chair !== null && row.chair === row.handle ? 'chair' : 'member'
  }));
}

export function removeMembership(roomId: string, handle: string): boolean {
  const db = getIdentityDb();
  const normalised = normalizeHandle(handle);
  const info = db
    .prepare(`DELETE FROM room_memberships WHERE room_id = ? AND handle = ?`)
    .run(roomId, normalised);
  return info.changes > 0;
}
