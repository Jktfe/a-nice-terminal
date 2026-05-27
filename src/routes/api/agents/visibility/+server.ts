/**
 * GET /api/agents/visibility[?includeArchived=1]
 *
 * Cross-room visibility primitive. Returns per-room visibility aggregates
 * (including priorityScore + per-viewer pinned/muted/archived flags) +
 * fleet-level agent counts for all rooms the caller can read. Default
 * sort: pinned first → priorityScore desc.
 *
 * Native apps (antios + antchat per eiw05zdurz contract 2026-05-27)
 * call this on app launch + on room-list-pull to refresh ordering.
 * `?includeArchived=1` opts into archived rooms for an "Archived" view.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { buildVisibilityForAccess } from '$lib/server/agentVisibilityStore';

export const GET: RequestHandler = async ({ request, url }) => {
  const access = await resolveChatRoomReadAccess(request);
  if (!access) {
    throw error(401, 'Authentication required.');
  }

  const includeArchived = url.searchParams.get('includeArchived') === '1';
  const summary = buildVisibilityForAccess(access, { includeArchived });
  return json(summary);
};
