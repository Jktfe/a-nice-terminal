/**
 * Single agent endpoint.
 *
 *   GET /api/agents/:handle
 *     → agent details with room memberships
 *
 *   PATCH /api/agents/:handle
 *     body { displayName?, displayColor?, displayIcon?, displayBackgroundStyle? }
 *     → update metadata globally across all rooms
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAgent, updateAgentMetadata } from '$lib/server/agentRegistryStore';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

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

export const GET: RequestHandler = async ({ params, request }) => {
  requireAggregateReadAuth(request, `/api/agents/${params.handle ?? ''}`);
  const agent = getAgent(params.handle);
  if (!agent) {
    throw error(404, 'Agent not found.');
  }
  return json({ agent: serialize(agent) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  requireOperatorLikeAuth(request);
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== 'object') {
    throw error(400, 'Send a JSON body.');
  }

  const patch: Parameters<typeof updateAgentMetadata>[1] = {};
  if (typeof body.displayName === 'string') patch.displayName = body.displayName;
  if (typeof body.displayColor === 'string') patch.displayColor = body.displayColor;
  if (typeof body.displayIcon === 'string') patch.displayIcon = body.displayIcon;
  if (typeof body.displayBackgroundStyle === 'string') patch.displayBackgroundStyle = body.displayBackgroundStyle;

  const ok = updateAgentMetadata(params.handle, patch);
  if (!ok) {
    throw error(400, 'No valid fields to update.');
  }

  const agent = getAgent(params.handle);
  return json({ agent: serialize(agent) });
};
