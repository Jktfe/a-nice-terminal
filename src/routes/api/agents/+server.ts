/**
 * Agents registry endpoint.
 *
 *   GET /api/agents
 *     → list all agents globally (deduplicated by handle)
 *
 *   GET /api/agents?roomId=xyz
 *     → list agents in one room
 *
 *   PATCH /api/agents/:handle
 *     → update agent metadata (display_color, display_icon, display_background_style, display_name)
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAgents, getAgent, updateAgentMetadata } from '$lib/server/agentRegistryStore';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';

function serialize(agent: ReturnType<typeof getAgent>) {
  if (!agent) return null;
  return {
    handle: agent.handle,
    displayName: agent.displayName,
    displayColor: agent.displayColor,
    displayIcon: agent.displayIcon,
    displayBackgroundStyle: agent.displayBackgroundStyle,
    rooms: agent.rooms,
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const roomId = url.searchParams.get('roomId');
  if (roomId) {
    if (!doesChatRoomExist(roomId)) {
      throw error(404, 'Room not found.');
    }
  }
  const agents = listAgents(roomId ?? undefined);
  return json({ agents: agents.map(serialize) });
};
