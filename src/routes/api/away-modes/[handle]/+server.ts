/**
 * GET /api/away-modes/:handle — get a user's away mode.
 * PUT /api/away-modes/:handle — set a user's away mode.
 * DELETE /api/away-modes/:handle — clear a user's away mode.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAwayMode, setAwayMode, clearAwayMode, isAllowedAwayTier } from '$lib/server/awayModeStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';

function requireAuth(request: Request): void {
  if (!tryAdminBearer(request)) {
    throw error(401, 'Authentication required.');
  }
}

export const GET: RequestHandler = async ({ params }) => {
  const mode = getAwayMode(params.handle);
  if (!mode) {
    // Return active as default when no record exists
    return json({
      mode: {
        handle: params.handle,
        tier: 'active',
        intensity: 50,
        note: null,
        expectedBackMs: null,
        setBy: null,
        setAtMs: 0
      }
    });
  }
  return json({ mode });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  requireAuth(request);
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw error(400, 'JSON body required.');
  }

  const tier = payload.tier;
  if (!isAllowedAwayTier(tier)) {
    throw error(400, 'tier must be active|away-desk|away-office|away-phone');
  }

  const intensity = typeof payload.intensity === 'number' ? payload.intensity : undefined;
  if (intensity !== undefined && (intensity < 0 || intensity > 100 || !Number.isFinite(intensity))) {
    throw error(400, 'intensity must be 0..100');
  }

  const mode = setAwayMode({
    handle: params.handle,
    tier,
    ...(intensity !== undefined && { intensity }),
    note: typeof payload.note === 'string' ? payload.note.trim() : null,
    expectedBackMs: typeof payload.expectedBackMs === 'number' && Number.isFinite(payload.expectedBackMs)
      ? payload.expectedBackMs
      : null,
    setBy: '@admin'
  });

  return json({ mode });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  requireAuth(request);
  clearAwayMode(params.handle);
  return json({ ok: true });
};
