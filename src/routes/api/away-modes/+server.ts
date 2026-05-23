/**
 * GET /api/away-modes — list away modes.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAwayModes, isAllowedAwayTier } from '$lib/server/awayModeStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';

function requireAuth(request: Request): void {
  if (!tryAdminBearer(request)) {
    throw error(401, 'Authentication required.');
  }
}

export const GET: RequestHandler = async ({ url, request }) => {
  requireAuth(request);
  const tier = url.searchParams.get('tier') as 'active' | 'away-desk' | 'away-office' | 'away-phone' | null;
  if (tier && !isAllowedAwayTier(tier)) {
    throw error(400, 'tier must be active|away-desk|away-office|away-phone');
  }
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  const modes = listAwayModes({
    ...(tier && { tier }),
    ...(limit && { limit })
  });

  return json({ modes });
};
