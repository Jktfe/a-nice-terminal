/**
 * Per-human inbox MEMBERSHIP recompute (JWPK 2026-05-22).
 *
 * Inbox membership for an agent in __inbox_<human>__ is DERIVED from two
 * orthogonal paths:
 *   (a) the agent shares at least one non-inbox chat room with the human
 *   (b) the agent inhabits a terminal whose terminal_records.created_by
 *       equals the human's handle
 *
 * Membership exists ⇔ (a) OR (b). Any change to either side triggers a
 * recompute for the affected (human, agent) pair. The recompute is
 * idempotent — it adds the membership row when needed, removes it when
 * neither path holds, and no-ops otherwise.
 *
 * Auto-remove is the JWPK-corrected behaviour: when the LAST shared room
 * is left AND the terminal-ownership is gone, the agent loses its inbox
 * seat. Side-channel access via stale inbox membership is impossible.
 *
 * The human always stays a member of their own inbox — this helper only
 * touches AGENT membership rows. Human-self-membership is seeded by
 * ensureHumanInboxRoom() and never recomputed away.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import { ensureHumanInboxRoom, inboxRoomIdFor, isInboxRoomId } from './humanInboxRoomStore';
import {
  mirrorAddMembership as v02MirrorAddMembership,
  mirrorRemoveMembership as v02MirrorRemoveMembership
} from './v02ChatRoomBridge';
import {
  shareActiveNonInboxRoom as v02ShareActiveNonInboxRoom,
  isHandleActiveMemberOfRoom as v02IsHandleActiveMemberOfRoom,
  listActiveMemberHandlesForRoom as v02ListActiveMemberHandlesForRoom
} from './v02MembershipsStore';

/** True when either path (a) or path (b) holds for this (human, agent). */
function sharedContextExists(humanHandle: string, agentHandle: string): boolean {
  const db = getIdentityDb();
  // M9d cut-over phase 3: path (a) reads v0.2 memberships (both
  // handles must have an active membership in the same non-inbox
  // room). Bridge auto-create guarantees a v0.2 row mirrors every
  // legacy chat_room_members write FOR NEW ROWS — but a legacy
  // chat_room_members row inserted by direct SQL (e.g. pre-cut-over
  // data + the humanInboxBackfill test fixture) won't have a v0.2
  // mirror until backfill runs. Fall through to a legacy
  // chat_room_members read so cut-over-window state is honoured.
  // Once chat_room_members is dropped (week-2 cleanup PR), the
  // fallback arm goes away with it.
  if (v02ShareActiveNonInboxRoom(humanHandle, agentHandle)) return true;
  const legacyShared = db.prepare(
    `SELECT 1 FROM chat_room_members a
     JOIN chat_room_members b ON a.room_id = b.room_id
     WHERE a.handle = ? AND b.handle = ?
       AND a.room_id NOT LIKE '__inbox_%'
     LIMIT 1`
  ).get(humanHandle, agentHandle);
  if (legacyShared) return true;
  // Path (b): any LIVE terminal_records row where the agent inhabits a
  // terminal the human created. Pane-binding supersession filter
  // (JWPK msg_wlvguvfvqu 2026-05-27): a recycled-pane terminal_record
  // does NOT extend inbox membership to its prior occupant — that
  // would let a previous agent retain inbox visibility after a new
  // agent took over the pane. terminal_records is NOT a
  // chat_room_members surface so this query is unchanged.
  const ownedTerminal = db.prepare(
    `SELECT 1 FROM terminal_records
     WHERE handle = ? AND created_by = ?
       AND superseded_at_ms IS NULL
     LIMIT 1`
  ).get(agentHandle, humanHandle);
  return !!ownedTerminal;
}

/**
 * Compute the correct inbox-membership state for ONE (human, agent) pair
 * and align the chat_room_members table to match. Idempotent + safe to
 * call from any hook on either side of the relationship.
 *
 * Always ensures the human's inbox room exists (cheap upsert) so the
 * caller doesn't need to remember to provision before hooking.
 */
export function recomputeInboxEdge(humanHandle: string, agentHandle: string): void {
  if (!humanHandle || !agentHandle || humanHandle === agentHandle) return;
  const inboxRoomId = ensureHumanInboxRoom(humanHandle);
  const db = getIdentityDb();
  const shouldBeMember = sharedContextExists(humanHandle, agentHandle);

  // M9d cut-over phase 3: presence probe now reads v0.2 memberships.
  // Legacy DELETE/INSERT below still touch chat_room_members for
  // rollback safety (dual-write); the bridge mirrors them into v0.2.
  const existing = v02IsHandleActiveMemberOfRoom(inboxRoomId, agentHandle);

  if (shouldBeMember && !existing) {
    const nowIso = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon,
       display_background_style, joined_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent')`).run(
      randomUUID(), inboxRoomId, agentHandle, agentHandle, '#0891B2',
      agentHandle.slice(1, 2).toUpperCase() || '?', 'transparent', nowIso
    );
    // M9c dual-write: mirror inbox-edge add into v0.2 memberships.
    // M9d enrichment: pass member_kind='agent' (inbox edges are always
    // agent rows — humans get added via the per-human inbox seed) +
    // matching display state so the v0.2 row is the source of truth
    // for read paths going forward.
    v02MirrorAddMembership({
      roomId: inboxRoomId,
      handle: agentHandle,
      displayName: agentHandle,
      memberKind: 'agent',
      roomDisplayName: agentHandle,
      displayColor: '#0891B2',
      displayIcon: agentHandle.slice(1, 2).toUpperCase() || '?',
      displayBackgroundStyle: 'transparent'
    });
  } else if (!shouldBeMember && existing) {
    // M9d ordering fix: mirror the v0.2 soft-leave BEFORE the legacy
    // DELETE so any subsequent v0.2 read in the same chain (e.g. a
    // sibling recompute on the same agent) sees the post-removal
    // state rather than a phantom active row.
    v02MirrorRemoveMembership(inboxRoomId, agentHandle);
    db.prepare(
      `DELETE FROM chat_room_members WHERE room_id = ? AND handle = ?`
    ).run(inboxRoomId, agentHandle);
  }
}

/**
 * Convenience: a member just joined or left `roomId`. Recompute every
 * (human, agent) edge in the room that involves `changedHandle`.
 *
 * Skips inbox rooms (they're targets of recompute, not triggers — a
 * change in inbox membership doesn't loop back).
 *
 * Walks chat_room_members directly so the recompute survives even when
 * `changedHandle` has already been deleted from the room (delete-then-
 * recompute ordering); we look up the OTHER members and pair changed
 * against each.
 */
export function recomputeInboxEdgesForRoomMembershipChange(
  roomId: string,
  changedHandle: string
): void {
  if (isInboxRoomId(roomId)) return;
  // M9d cut-over phase 3: read changed-handle kind + other-member
  // roster from v0.2 memberships. member_kind on memberships replaces
  // chat_room_members.kind; the SQL falls back to a NULL row when
  // the changed handle has no remaining memberships (delete-then-
  // recompute path), preserving the legacy "try both directions"
  // behaviour.
  const db = getIdentityDb();
  const changedKindRow = db.prepare(
    `SELECT m.member_kind AS kind
       FROM memberships m
       JOIN agents a ON a.agent_id = m.agent_id
      WHERE (m.room_alias = ? OR a.primary_handle = ?)
        AND m.member_kind IS NOT NULL
      ORDER BY m.left_at_ms IS NULL DESC, m.joined_at_ms DESC
      LIMIT 1`
  ).get(changedHandle, changedHandle) as { kind: 'human' | 'agent' | null } | undefined;
  const changedKind: 'human' | 'agent' | undefined =
    changedKindRow?.kind === 'human' || changedKindRow?.kind === 'agent'
      ? changedKindRow.kind
      : undefined;
  const otherMembers = v02ListActiveMemberHandlesForRoom(roomId);
  for (const other of otherMembers) {
    if (other.handle === changedHandle) continue;
    if (other.member_kind === null) {
      // Legacy row pre-dating member_kind ALTER — fall back to the
      // legacy chat_room_members kind lookup so we don't lose an
      // edge during the cut-over window.
      const legacyKind = db.prepare(
        `SELECT kind FROM chat_room_members WHERE handle = ? AND room_id = ? LIMIT 1`
      ).get(other.handle, roomId) as { kind: 'human' | 'agent' } | undefined;
      if (!legacyKind) continue;
      if (changedKind === 'human' && legacyKind.kind === 'agent') {
        recomputeInboxEdge(changedHandle, other.handle);
      } else if (changedKind === 'agent' && legacyKind.kind === 'human') {
        recomputeInboxEdge(other.handle, changedHandle);
      } else if (!changedKind && legacyKind.kind === 'human') {
        recomputeInboxEdge(other.handle, changedHandle);
      }
      continue;
    }
    // Pair (human, agent) ordered.
    if (changedKind === 'human' && other.member_kind === 'agent') {
      recomputeInboxEdge(changedHandle, other.handle);
    } else if (changedKind === 'agent' && other.member_kind === 'human') {
      recomputeInboxEdge(other.handle, changedHandle);
    } else if (!changedKind) {
      // Unknown kind — try the pairing where one is human, one agent.
      if (other.member_kind === 'human') {
        recomputeInboxEdge(other.handle, changedHandle);
      } else {
        // Both unknown / both agents → not an inbox edge, skip.
      }
    }
  }
}

/**
 * Convenience: a terminal_records row's created_by changed. Recompute
 * the agent-side membership in both the OLD owner's inbox (in case
 * removal is now warranted) and the NEW owner's inbox.
 */
export function recomputeInboxEdgesForTerminalOwnershipChange(input: {
  agentHandle: string;
  previousOwnerHandle?: string | null;
  newOwnerHandle?: string | null;
}): void {
  if (input.previousOwnerHandle && input.previousOwnerHandle !== input.newOwnerHandle) {
    recomputeInboxEdge(input.previousOwnerHandle, input.agentHandle);
  }
  if (input.newOwnerHandle) {
    recomputeInboxEdge(input.newOwnerHandle, input.agentHandle);
  }
}

export { inboxRoomIdFor };
