/**
 * GET /api/agents/visibility
 *
 * Cross-room visibility primitive.
 * Returns per-room visibility aggregates + fleet-level agent counts
 * for all rooms the caller can read.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { buildVisibilityForAccess } from '$lib/server/agentVisibilityStore';

export const GET: RequestHandler = async ({ request }) => {
  const access = await resolveChatRoomReadAccess(request);
  if (!access) {
    throw error(401, 'Authentication required.');
  }

  const summary = buildVisibilityForAccess(access);
  return json(summary);
};
