/**
 * agentVisibilityStore.ts
 *
 * Cross-room visibility primitive (JWPK priority #3, 2026-05-25).
 *
 * Aggregates per-room stats (agent count, human count, open asks,
 * last activity) across all rooms the caller can read, plus fleet-level
 * agent state from terminals.agent_status. Used by dashboard / room-list
 * surfaces to show activity without requiring membership in every room.
 */

import { getIdentityDb } from './db';
import { listChatRooms, type ChatRoom } from './chatRoomStore';
import { listOpenAsksInRoom } from './askStore';
import type { ChatRoomReadAccess } from './chatRoomReadGate';
import { canReadChatRoom } from './chatRoomReadGate';
import { listRoomMemberPreferencesForHandle } from './roomMemberPreferencesStore';

export type RoomVisibility = {
  id: string;
  name: string;
  description: string | null;
  lastActivityAtMs: number;
  agentCount: number;
  humanCount: number;
  openAskCount: number;
  /**
   * Open asks where the viewer is the target. Subset of openAskCount.
   * Drives the "needs my attention" signal in native app sidebars
   * (antios + antchat per the eiw05zdurz contract 2026-05-27).
   */
  openAsksForViewer: number;
  /**
   * Computed priority score for default sidebar ordering. Higher = floats
   * higher. Formula (v1, tunable):
   *   100 · openAsksForViewer
   *   + 0.1 · (agentCount + humanCount)            (room population, very weak)
   *   + 60_000_000 / max(1, msSinceLastActivity)    (recency, decays smoothly)
   * Mentions + active-plan signals slot in here when the data path is
   * cheap; today we lean on openAsksForViewer + recency, which are both
   * free to compute alongside the existing aggregates.
   * Clients can layer local pin/mute on top of this score.
   */
  priorityScore: number;
  /**
   * Per-viewer preference flags from room_member_preferences. Clients
   * compose: pinned floats above non-pinned regardless of score; muted
   * already has score zeroed server-side; archived rooms are hidden
   * unless caller passes includeArchived=true.
   */
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  contractId: string | null;
};

export type AgentVisibilitySummary = {
  rooms: RoomVisibility[];
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
};

/**
 * Compute the priority score for a single room. Higher = floats higher
 * in client sidebars. v1 formula:
 *
 *   100 · openAsksForViewer
 *   + 0.1 · (agentCount + humanCount)
 *   + 60_000_000 / max(1, msSinceLastActivity)
 *
 * When the viewer has muted the room, returns 0 — muted rooms demote
 * to the bottom of the default sort. Pinned rooms are NOT boosted
 * here; clients compose pinned-first → priority-sorted → muted-demoted
 * → archived-hidden (pinning is a client-composition concern, not a
 * scoring concern).
 *
 * Exported for unit tests so the formula can change without flaky
 * end-to-end integration tests.
 */
export function priorityScoreFor(input: {
  openAsksForViewer: number;
  populationCount: number;
  msSinceLastActivity: number;
  muted: boolean;
  nowMs?: number;
}): number {
  if (input.muted) return 0;
  const asksTerm = 100 * Math.max(0, input.openAsksForViewer);
  const popTerm = 0.1 * Math.max(0, input.populationCount);
  // Defensive max() against NaN: Math.max(1, NaN) → NaN, so coerce
  // non-finite msSinceLastActivity to a sane large value first.
  const safeMs = Number.isFinite(input.msSinceLastActivity)
    ? Math.max(1, input.msSinceLastActivity)
    : 60_000;
  const recencyTerm = 60_000_000 / safeMs;
  return asksTerm + popTerm + recencyTerm;
}

export function buildVisibilityForAccess(
  access: ChatRoomReadAccess,
  options?: { includeArchived?: boolean; nowMs?: number }
): AgentVisibilitySummary {
  const db = getIdentityDb();
  const nowMs = options?.nowMs ?? Date.now();
  const includeArchived = options?.includeArchived === true;

  // Pre-load this viewer's room preferences so we can merge per-room
  // flags without N round-trips. Empty map for callers without a handle
  // (admin-bearer with no handle has no per-viewer prefs).
  const viewerHandle = access.handles[0] ?? null;
  const prefsByRoom = new Map<string, { pinned: boolean; muted: boolean; archived: boolean }>();
  if (viewerHandle) {
    for (const pref of listRoomMemberPreferencesForHandle(viewerHandle)) {
      prefsByRoom.set(pref.roomId, {
        pinned: pref.pinned,
        muted: pref.muted,
        archived: pref.archived
      });
    }
  }

  // All non-deleted/archived rooms
  const allRooms = listChatRooms();
  const readableRooms = access.isAdminBearer
    ? allRooms
    : allRooms.filter((room) => canReadChatRoom(room, access));

  const rooms: RoomVisibility[] = readableRooms.flatMap((room) => {
    const flags = prefsByRoom.get(room.id) ?? { pinned: false, muted: false, archived: false };
    // Default behaviour: hide archived rooms unless caller opted in.
    // Archived rooms are still readable via the explicit includeArchived
    // request (e.g. an "Archived" filter in the native app).
    if (flags.archived && !includeArchived) return [];

    const agents = room.members.filter((m) => m.kind === 'agent');
    const humans = room.members.filter((m) => m.kind === 'human');
    const openAsks = listOpenAsksInRoom(room.id);
    const openAsksForViewer = viewerHandle
      ? openAsks.filter((ask) => ask.targetHandle === viewerHandle).length
      : 0;
    // `room.lastUpdate` is a human-readable label ("just now", "5m ago",
    // or an ISO timestamp depending on what wrote it). Parse defensively
    // — NaN from un-parseable labels falls back to the creation timestamp,
    // which is always a real ISO date from createChatRoom. If both fail,
    // treat as nowMs (fresh-now). Ensures priorityScore never produces
    // NaN downstream.
    const parsedLastUpdate = new Date(room.lastUpdate).getTime();
    const parsedCreated = new Date(room.whenItWasCreated).getTime();
    const lastActivityAtMs = Number.isFinite(parsedLastUpdate)
      ? parsedLastUpdate
      : (Number.isFinite(parsedCreated) ? parsedCreated : nowMs);
    const priorityScore = priorityScoreFor({
      openAsksForViewer,
      populationCount: agents.length + humans.length,
      msSinceLastActivity: nowMs - lastActivityAtMs,
      muted: flags.muted,
      nowMs
    });

    return [{
      id: room.id,
      name: room.name,
      description: room.description,
      lastActivityAtMs,
      agentCount: agents.length,
      humanCount: humans.length,
      openAskCount: openAsks.length,
      openAsksForViewer,
      priorityScore,
      pinned: flags.pinned,
      muted: flags.muted,
      archived: flags.archived,
      contractId: room.contractId,
    }];
  });

  // Default order: pinned first (within pinned, sort by priorityScore
  // desc); then non-pinned by priorityScore desc. Clients can re-sort
  // locally if they need a different mode but the wire default matches
  // the expected sidebar order.
  rooms.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.priorityScore - a.priorityScore;
  });

  // Fleet-wide agent counts from terminals table (agent_status / agent_status_at_ms)
  const activeThresholdMs = Date.now() - 5 * 60 * 1000;
  const totalRow = db
    .prepare("SELECT COUNT(*) as total FROM terminals WHERE agent_kind IS NOT NULL AND agent_kind != 'remote'")
    .get() as { total: number };
  const activeRow = db
    .prepare("SELECT COUNT(*) as active FROM terminals WHERE agent_kind IS NOT NULL AND agent_kind != 'remote' AND agent_status_at_ms > ?")
    .get(activeThresholdMs) as { active: number };

  const totalAgents = totalRow?.total ?? 0;
  const activeAgents = activeRow?.active ?? 0;

  return {
    rooms,
    totalAgents,
    activeAgents,
    idleAgents: totalAgents - activeAgents,
  };
}
