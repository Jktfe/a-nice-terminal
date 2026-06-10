/**
 * /api/plans/:planId/rooms — plan↔room link surface (collection).
 *
 * GET  → list of rooms attached to this plan
 *        200 { rooms: [{ roomId, name, attachedAtMs, attachedBy }] }
 *
 * POST → attach a room to this plan.
 *        Body: { roomId, attachedBy? }
 *        Auth: admin-bearer OR valid browser-session cookie (user-facing
 *        UI flow). JWPK msg_xyrlvisazp: room-attach UI must work from the
 *        room page itself, not just from CLI/admin scripts.
 *        200 { attached: boolean, alreadyAttached: boolean }  (idempotent)
 *        400 missing roomId / malformed body
 *        401 no admin-bearer AND no valid browser-session
 *        404 room not found
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  canReadChatRoom,
  resolveChatRoomReadAccess
} from '$lib/server/chatRoomReadGate';
import {
  attachPlanToRoom,
  listRoomsForPlan,
  PlanRoomLinkError
} from '$lib/server/planRoomLinkStore';
import { broadcastPlanChanged } from '$lib/server/taskPlanRealtime';

type PlanRoomLinkAuth =
  | { kind: 'cookie'; actor: string }
  | { kind: 'admin' };

function requirePlanRoomLinkAuth(request: Request): PlanRoomLinkAuth {
  // Path 1 — cookie/Bearer (user-facing UI + Mac app). Iterates every
  // ant_browser_session cookie via resolveCallerHandleAnyRoom, so a stale
  // Path=/ demo-login cookie can't mask a valid Path=/api/chat-rooms/{id}
  // cookie (the antv4-only collision bug, JWPK msg_y0p7c8j3sr 2026-05-19).
  const cookieHandle = resolveCallerHandleAnyRoom(request);
  if (cookieHandle) return { kind: 'cookie', actor: cookieHandle };
  // Path 2 — admin-bearer (CLI/scripts, ANT_ADMIN_TOKEN flow).
  try {
    requireAdminAuth(request);
    return { kind: 'admin' };
  } catch {
    /* fall through */
  }
  throw error(401, 'browser-session, antchat Bearer, or admin-bearer required');
}

export const GET: RequestHandler = async ({ params, request }) => {
  const planId = params.planId ?? '';
  if (planId.length === 0) throw error(400, 'planId is required.');
  const access = await resolveChatRoomReadAccess(request);
  if (!access) throw error(401, 'Authentication required.');
  const rooms = listRoomsForPlan(planId);
  if (access.isAdminBearer) return json({ rooms });
  return json({
    rooms: rooms.filter((link) => {
      const room = findChatRoomById(link.roomId);
      return room ? canReadChatRoom(room, access) : false;
    })
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const auth = requirePlanRoomLinkAuth(request);
  const planId = params.planId ?? '';
  if (planId.length === 0) throw error(400, 'planId is required.');

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object body.');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.roomId !== 'string' || b.roomId.trim().length === 0) {
    throw error(400, 'roomId is required.');
  }
  // Cookie path: attribution is the server-resolved handle (cannot be
  // overridden via body.attachedBy — anti-spoof). Admin path: honour
  // body.attachedBy for back-compat with the CLI fleet that posts
  // attachedBy='@evolveant…' verbatim.
  const attachedBy =
    auth.kind === 'cookie'
      ? auth.actor
      : typeof b.attachedBy === 'string'
        ? b.attachedBy
        : null;

  try {
    const result = attachPlanToRoom({ planId, roomId: b.roomId, attachedBy });
    // Realtime: a fresh attachment changes the target room's Plans panel.
    if (result.attached) broadcastPlanChanged(planId, { action: 'attached' }, [b.roomId]);
    return json(result);
  } catch (cause) {
    if (cause instanceof PlanRoomLinkError && cause.reason === 'room_not_found') {
      throw error(404, cause.message);
    }
    throw cause;
  }
};
