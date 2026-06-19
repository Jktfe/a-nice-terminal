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
import { listFleetAgents } from '$lib/server/agentFleetStore';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { listTerminals } from '$lib/server/ptyClient';

const DEFAULT_FLEET_LIVE_SESSION_CACHE_MS = 3_000;
let liveSessionCache: { sessionIds: string[]; expiresAtMs: number } | null = null;
let liveSessionRefresh: Promise<string[]> | null = null;

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

function fleetLiveSessionCacheMs(): number {
  const raw = Number(process.env.ANT_AGENTS_LIVE_SESSION_CACHE_MS);
  if (Number.isInteger(raw) && raw >= 0) return raw;
  return DEFAULT_FLEET_LIVE_SESSION_CACHE_MS;
}

async function liveSessionIdsForFleet(): Promise<Set<string>> {
  const nowMs = Date.now();
  if (liveSessionCache && liveSessionCache.expiresAtMs > nowMs) {
    return new Set(liveSessionCache.sessionIds);
  }

  if (!liveSessionRefresh) {
    liveSessionRefresh = listTerminals()
      .then((sessionIds) => {
        liveSessionCache = {
          sessionIds,
          expiresAtMs: Date.now() + fleetLiveSessionCacheMs()
        };
        return sessionIds;
      })
      .finally(() => {
        liveSessionRefresh = null;
      });
  }

  return new Set(await liveSessionRefresh);
}

export function _resetAgentsLiveSessionCacheForTests(): void {
  liveSessionCache = null;
  liveSessionRefresh = null;
}

export const GET: RequestHandler = async ({ url, request }) => {
  requireAggregateReadAuth(request, '/api/agents');
  const roomId = url.searchParams.get('roomId');
  if (roomId) {
    if (!doesChatRoomExist(roomId)) {
      throw error(404, 'Room not found.');
    }
  }
  if (url.searchParams.get('view') === 'fleet') {
    const liveSessionIds = await liveSessionIdsForFleet();
    return json({ agents: listFleetAgents(liveSessionIds) });
  }
  const agents = listAgents(roomId ?? undefined);
  return json({ agents: agents.map(serialize) });
};
