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
import { resolveMemoryVaultPath } from './memoryVaultSettingsStore';
import type { TerminalRow } from './terminalsStore';

// β3 (JWPK msg_fuvbzkd4wx 2026-05-23): on first agent join into a room, post
// a one-time system message stating the context-break + memory rules. Skips
// human handles (who already know the rules) and skips on existing-row
// re-bind (the message is per-(room, agent) first-time only).
//
// 2026-05-28 update (JWPK orsz msg_szk0m5cwqn): the memory-pack path was
// previously hardcoded in the repo. Now resolved at emission time via
// `resolveMemoryVaultPath()` — env var `ANT_MEMORY_VAULT_PATH` or
// `~/.ant/memory-vault.json` settings file. Nothing about the path lives
// in this repo file. Unset case: the preamble prompts the agent to set
// the path before continuing.
export function buildAgentJoinPreamble(vaultPath: string | null): string {
  const lines = [
    '**Agent join — context discipline for this room** (one-time system notice).',
    '',
    '1. `kind=system-break` messages are a HARD backwards-scan boundary. Don\'t read older context unless explicitly asked.'
  ];
  if (vaultPath !== null) {
    lines.push(
      `2. Read the configured memory pack README at \`${vaultPath}/README.md\` before acting. Use \`ant memory recall --search "<topic>"\` to load only the memories relevant to this room/task; the CLI resolves the memory-pack root from config/env.`
    );
  } else {
    lines.push(
      '2. Read the configured memory pack README before acting. If `ant memory recall --search "<topic>"` says no memory pack is configured, set it with `ant memory vault set --path <PATH>` or `ANT_MEMORY_VAULT_PATH` and retry.'
    );
  }
  lines.push(
    '3. Room-linked memories are shared operating context. Attach relevant memIDs to the room; do not duplicate the memory text into chat unless needed for a decision.',
    '',
    'Use the ask primitive for real decisions. Tight ACKs for coordination. Surface obstacles as 2-4 logic-shape paths, never bulk-dump.'
  );
  return lines.join('\n');
}

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
  // Resolve vault path at emission time so the preamble carries the
  // actual location, not a placeholder — JWPK orsz msg_szk0m5cwqn.
  // Env var wins; falls back to ~/.ant/memory-vault.json; null when
  // unset (preamble shows the set-it instruction).
  const vaultPath = resolveMemoryVaultPath();
  postSystemMessage({ roomId, body: buildAgentJoinPreamble(vaultPath) });
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

/**
 * Heartbeat threshold (ms) — beyond this gap since the last message-send
 * or pty-byte touch, a terminal is considered stale and a fresh register
 * may auto-rebind its handle. Mirrors the agentStatusPoller heartbeat
 * sweep window so a row that's already a candidate for self-archive is
 * also a candidate for handle re-bind. JWPK A Team msg_w7sfmc4hpp
 * 2026-05-29 default Q3 = 5 minutes.
 */
const REBIND_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * PR-B v0.2 of register reshape (2026-05-29). Predicate: "is this old
 * terminal stale enough that a fresh register for the same handle can
 * safely re-point room_memberships at the new terminal?". Safe-by-
 * construction — only returns true when the row is clearly abandoned,
 * NEVER on a live row even briefly idle.
 *
 * True when ANY of:
 *   - candidate.status is already 'archived' or 'deleted' (the lifecycle
 *     poller / operator already declared it dead).
 *   - candidate.pane_status is 'stale' (last tmux verification said the
 *     pane is gone).
 *   - max(last_message_sent_at_ms, last_pty_byte_at_ms) is older than
 *     5 minutes ago. If both timestamps are null/0 the row has never
 *     emitted traffic — also treated as stale because the fresh register
 *     that triggered this check IS the first sign of life under this
 *     handle.
 */
export function isCandidateStale(candidate: TerminalRow, nowMs: number): boolean {
  if (candidate.status === 'archived' || candidate.status === 'deleted') return true;
  if (candidate.pane_status === 'stale') return true;
  const latest = Math.max(
    candidate.last_message_sent_at_ms ?? 0,
    candidate.last_pty_byte_at_ms ?? 0
  );
  if (latest === 0) return true;
  return nowMs - latest > REBIND_STALE_THRESHOLD_MS;
}

/**
 * PR-B v0.2 of register reshape (2026-05-29). When a fresh `ant register`
 * lands and a stale terminal_record for the same handle exists,
 * atomically:
 *   (1) move every room_memberships row from old → new terminal_id;
 *   (2) flip the old terminals row to status='archived';
 *   (3) mark the old terminal_records row as superseded_at_ms = nowMs.
 *
 * Caller MUST decide whether to rebind via `isCandidateStale` — we do NOT
 * want to steal memberships from a live session that's only briefly idle.
 *
 * Closes the dual-terminal trap that bit @speedyc in v4.1 on 2026-05-29:
 * `ant register --name SpeedyC` on a fresh shell created a new
 * terminal_record but left existing room_memberships rows pointing at
 * the old abandoned terminal, so UI roster showed @speedyc present in
 * the new shell but fanout-inject delivered to the dead pane.
 *
 * Returns the count of room_memberships rows rebound and the affected
 * room_ids so the caller can emit a structured log entry. Self-rebind
 * (oldTerminalId === newTerminalId) returns {0, []} without writing.
 */
export function autoRebindMembershipsFromStaleTerminal(params: {
  handle: string;
  oldTerminalId: string;
  newTerminalId: string;
  nowMs: number;
}): { reboundCount: number; affectedRoomIds: string[] } {
  const { handle, oldTerminalId, newTerminalId, nowMs } = params;
  if (oldTerminalId === newTerminalId) {
    return { reboundCount: 0, affectedRoomIds: [] };
  }
  const normalised = normalizeHandle(handle);
  if (normalised.length === 0) {
    return { reboundCount: 0, affectedRoomIds: [] };
  }
  const db = getIdentityDb();
  // Single transaction so a mid-flight crash can't leave room_memberships
  // partially re-pointed (some rooms on new, others on old).
  const txn = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT id, room_id FROM room_memberships
          WHERE terminal_id = ? AND handle = ? AND revoked_at_ms IS NULL`
      )
      .all(oldTerminalId, normalised) as Array<{ id: string; room_id: string }>;
    const affectedRoomIds: string[] = [];
    for (const row of rows) {
      db.prepare(`UPDATE room_memberships SET terminal_id = ? WHERE id = ?`).run(
        newTerminalId,
        row.id
      );
      affectedRoomIds.push(row.room_id);
    }
    // Flip the old terminals row to archived so subsequent picker /
    // fanout / status reads skip it. Best-effort — a missing row (e.g.
    // terminals row already deleted) just produces zero changes here.
    db.prepare(
      `UPDATE terminals SET status = 'archived', updated_at = ?
        WHERE id = ? AND status = 'live'`
    ).run(Math.floor(nowMs / 1000), oldTerminalId);
    // Mark the old terminal_records row as superseded so picker queries
    // that filter on `superseded_at_ms IS NULL` skip it. Same pattern as
    // pane-binding supersession in terminalRecordsStore.ts.
    db.prepare(
      `UPDATE terminal_records SET superseded_at_ms = ?, updated_at_ms = ?
        WHERE session_id = ? AND superseded_at_ms IS NULL`
    ).run(nowMs, nowMs, oldTerminalId);
    return { reboundCount: rows.length, affectedRoomIds };
  });
  return txn();
}
