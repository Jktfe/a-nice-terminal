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

export type RoomVisibility = {
  id: string;
  name: string;
  description: string | null;
  lastActivityAtMs: number;
  agentCount: number;
  humanCount: number;
  openAskCount: number;
  contractId: string | null;
};

export type AgentVisibilitySummary = {
  rooms: RoomVisibility[];
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
};

export function buildVisibilityForAccess(access: ChatRoomReadAccess): AgentVisibilitySummary {
  const db = getIdentityDb();

  // All non-deleted/archived rooms
  const allRooms = listChatRooms();
  const readableRooms = access.isAdminBearer
    ? allRooms
    : allRooms.filter((room) => canReadChatRoom(room, access));

  const rooms: RoomVisibility[] = readableRooms.map((room) => {
    const agents = room.members.filter((m) => m.kind === 'agent');
    const humans = room.members.filter((m) => m.kind === 'human');
    const openAsks = listOpenAsksInRoom(room.id);

    return {
      id: room.id,
      name: room.name,
      description: room.description,
      lastActivityAtMs: new Date(room.lastUpdate).getTime(),
      agentCount: agents.length,
      humanCount: humans.length,
      openAskCount: openAsks.length,
      contractId: room.contractId,
    };
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
