/**
 * GET /api/agents/availability — single-shot fleet availability rollup.
 *
 *   ?alive=true|false   include archived (alive=false) for audit/debug
 *   ?inRoom=true|false  filter to handles that are / aren't currently in a room
 *   ?model=claude|...   filter by model suffix inference
 *   ?skill=stripe|...   filter by inferred skill set
 *   ?roomId=xxx         filter to agents in a specific room
 *
 * JWPK directive (2026-05-20): "we should be able to get this info at the
 * drop of a hat". Returns BOTH the roster and a rolled-up summary so callers
 * can render a single row without follow-up requests.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listAgentAvailability,
  type AvailabilityFilters,
} from '$lib/server/agentAvailabilityStore';

function parseBool(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

export const GET: RequestHandler = async ({ url }) => {
  const filters: AvailabilityFilters = {
    // Default to alive=true so the noisy archived rows stay off the
    // common-case fleet view; pass ?alive=false to widen for audits.
    alive: parseBool(url.searchParams.get('alive')) ?? true,
    inRoom: parseBool(url.searchParams.get('inRoom')),
    model: url.searchParams.get('model') ?? undefined,
    skill: url.searchParams.get('skill') ?? undefined,
    roomId: url.searchParams.get('roomId') ?? undefined,
  };
  const { agents, summary } = listAgentAvailability(filters);
  return json({ agents, summary });
};
