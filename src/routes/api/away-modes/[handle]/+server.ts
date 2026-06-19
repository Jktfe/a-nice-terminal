/**
 * GET    /api/away-modes/:handle — get a user's away mode.
 * PUT    /api/away-modes/:handle — set a user's away mode.
 * DELETE /api/away-modes/:handle — clear a user's away mode.
 *
 * Auth shape (per @speedycodex CHANGES REQUESTED 2026-05-24, banked in
 * orsz2321qb msg_ul0qt6x80m): admin-bearer OR browser-session cookie
 * where the cookie-resolved handle matches the URL `:handle` param.
 * Browser-session callers can only get/set/clear their OWN away mode —
 * no setting someone else's tier.
 *
 * Why server-observable persistence: localStorage state was invisible
 * to agents/server, so the "away from desk vs working" distinction
 * couldn't change agent behaviour while JWPK was away. Persistence in
 * the away_modes table → agents read via getAwayMode() → behaviour shift.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAwayMode, setAwayMode, clearAwayMode, isAllowedAwayTier } from '$lib/server/awayModeStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { resolveBrowserSessionSecretIgnoringRoom } from '$lib/server/browserSessionStore';
import { getCookieValuesFromRequest } from '$lib/server/authGate';
import { canonicaliseOperatorHandle } from '$lib/server/operatorHandle';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { listRoomsForHandle } from '$lib/server/membershipStore';
import type { AwayMode } from '$lib/server/awayModeStore';

type Auth = { kind: 'admin' | 'self'; setBy: string } | null;

function resolveAuth(handleParam: string, request: Request): Auth {
  if (tryAdminBearer(request)) {
    return { kind: 'admin', setBy: '@admin' };
  }
  // Browser-session caller: cookie-resolved handle must equal URL :handle param.
  const cookieSecrets = getCookieValuesFromRequest(request, 'ant_browser_session');
  for (const secret of cookieSecrets) {
    const resolved = resolveBrowserSessionSecretIgnoringRoom(secret);
    if (resolved && resolved.handle === handleParam) {
      return { kind: 'self', setBy: resolved.handle };
    }
  }
  return null;
}

function broadcastAwayModeChanged(handle: string, mode: AwayMode | null): void {
  for (const roomId of listRoomsForHandle(handle)) {
    try {
      broadcastToRoom(roomId, {
        type: 'away_mode_changed',
        handle,
        mode,
        cleared: mode === null
      });
    } catch {
      /* realtime broadcast is best-effort; away state already persisted */
    }
  }
}

export const GET: RequestHandler = async ({ params, request }) => {
  const handle = canonicaliseOperatorHandle(params.handle);
  const auth = resolveAuth(handle, request);
  if (!auth) throw error(401, 'Authentication required.');
  const mode = getAwayMode(handle);
  if (!mode) {
    // Default to active when no record exists — tells the UI the user
    // hasn't picked a tier yet so it can fall back to the room-mode
    // derived guess for visual state.
    return json({
      mode: {
        handle,
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
  const handle = canonicaliseOperatorHandle(params.handle);
  const auth = resolveAuth(handle, request);
  if (!auth) throw error(401, 'Authentication required.');
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
    handle,
    tier,
    ...(intensity !== undefined && { intensity }),
    note: typeof payload.note === 'string' ? payload.note.trim() : null,
    expectedBackMs: typeof payload.expectedBackMs === 'number' && Number.isFinite(payload.expectedBackMs)
      ? payload.expectedBackMs
      : null,
    setBy: auth.setBy
  });
  broadcastAwayModeChanged(handle, mode);

  return json({ mode });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const handle = canonicaliseOperatorHandle(params.handle);
  const auth = resolveAuth(handle, request);
  if (!auth) throw error(401, 'Authentication required.');
  clearAwayMode(handle);
  broadcastAwayModeChanged(handle, null);
  return json({ ok: true });
};
