/**
 * Per-room status surface (M3.4a-v1 + M3.4a-v2 rich extension).
 *
 *   GET  /api/chat-rooms/:roomId/status[?rich=1]
 *     → 200 { roomId, members: [{ handle, terminal_id, pane_status,
 *                                  pane_stale_since, updated_at,
 *                                  agent_status?, agent_status_source?,
 *                                  agent_status_at_ms? }, ...] }
 *     → 404 if room not found.
 *
 * v1 surfaces pane_status (verified | unknown | stale) per room member.
 * v2 ?rich=1 ADDS agent_status + source + at_ms fields per member (M3.4a-v2
 * design contract 2026-05-14 Q7 LOCK). When ?rich=1 is absent, response is
 * BYTE-COMPATIBLE with v1 (no agent_status fields). Read-only — no pidChain.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { listMembershipsForRoom } from '$lib/server/roomMembershipsStore';
import { getTerminalById } from '$lib/server/terminalsStore';
import { getAgentStatus } from '$lib/server/agentStatusStore';
import { projectEffectiveAgentStatus } from '$lib/server/effectiveAgentStatus';

export const GET: RequestHandler = async ({ params, url }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }
  const rich = url.searchParams.get('rich') === '1';
  const memberships = listMembershipsForRoom(params.roomId);
  const members = memberships.map((m) => {
    const terminal = getTerminalById(m.terminal_id);
    const base = {
      handle: m.handle,
      terminal_id: m.terminal_id,
      pane_status: terminal?.pane_status ?? 'unknown',
      pane_stale_since: terminal?.pane_stale_since ?? null,
      updated_at: terminal?.updated_at ?? null
    };
    if (!rich) return base;
    const agentRow = getAgentStatus(m.terminal_id);
    const effective = projectEffectiveAgentStatus(agentRow);
    return {
      ...base,
      agent_status: effective.agent_status,
      agent_status_source: effective.agent_status_source,
      agent_status_at_ms: effective.agent_status_at_ms
    };
  });
  return json({ roomId: params.roomId, members });
};
