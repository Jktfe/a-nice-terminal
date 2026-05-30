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

/** True when either path (a) or path (b) holds for this (human, agent). */
function sharedContextExists(humanHandle: string, agentHandle: string): boolean {
  const db = getIdentityDb();
  // Path (a): any non-inbox room both are members of.
  const sharedRoom = db.prepare(
    `SELECT 1 FROM chat_room_members a
     JOIN chat_room_members b ON a.room_id = b.room_id
     WHERE a.handle = ? AND b.handle = ?
       AND a.room_id NOT LIKE '__inbox_%'
     LIMIT 1`
  ).get(humanHandle, agentHandle);
  if (sharedRoom) return true;
  // Path (b): any LIVE terminal_records row where the agent inhabits a
  // terminal the human created. Pane-binding supersession filter
  // (JWPK msg_wlvguvfvqu 2026-05-27): a recycled-pane terminal_record
  // does NOT extend inbox membership to its prior occupant — that
  // would let a previous agent retain inbox visibility after a new
  // agent took over the pane.
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

  const existing = db.prepare(
    `SELECT 1 FROM chat_room_members WHERE room_id = ? AND handle = ?`
  ).get(inboxRoomId, agentHandle);

  if (shouldBeMember && !existing) {
    const nowIso = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon,
       display_background_style, joined_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent')`).run(
      randomUUID(), inboxRoomId, agentHandle, agentHandle, '#0891B2',
      agentHandle.slice(1, 2).toUpperCase() || '?', 'transparent', nowIso
    );
    // M9c dual-write: mirror inbox-edge add into v02_memberships.
    v02MirrorAddMembership({
      roomId: inboxRoomId,
      handle: agentHandle,
      displayName: agentHandle
    });
  } else if (!shouldBeMember && existing) {
    db.prepare(
      `DELETE FROM chat_room_members WHERE room_id = ? AND handle = ?`
    ).run(inboxRoomId, agentHandle);
    // M9c dual-write: mirror inbox-edge soft-leave into v02_memberships.
    v02MirrorRemoveMembership(inboxRoomId, agentHandle);
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
  const db = getIdentityDb();
  const changedKind = db.prepare(
    `SELECT kind FROM chat_room_members WHERE handle = ? LIMIT 1`
  ).get(changedHandle) as { kind: 'human' | 'agent' } | undefined;
  // If the changed handle has no remaining membership rows we can't infer
  // kind from chat_room_members — fall back to "try both directions".
  const otherMembers = db.prepare(
    `SELECT handle, kind FROM chat_room_members WHERE room_id = ?`
  ).all(roomId) as Array<{ handle: string; kind: 'human' | 'agent' }>;
  for (const other of otherMembers) {
    if (other.handle === changedHandle) continue;
    // Pair (human, agent) ordered.
    if (changedKind?.kind === 'human' && other.kind === 'agent') {
      recomputeInboxEdge(changedHandle, other.handle);
    } else if (changedKind?.kind === 'agent' && other.kind === 'human') {
      recomputeInboxEdge(other.handle, changedHandle);
    } else if (!changedKind) {
      // Unknown kind — try the pairing where one is human, one agent.
      if (other.kind === 'human') {
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
