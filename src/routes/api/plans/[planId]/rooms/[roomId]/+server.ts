/**
 * DELETE /api/plans/:planId/rooms/:roomId — detach a plan↔room link.
 *
 * 200 { removed: boolean }  (idempotent — false when no such link)
 * 400 missing planId/roomId
 * 401 missing/wrong identity (no cookie/Bearer AND no admin-bearer)
 * 503 ANT_ADMIN_TOKEN env not set (admin-bearer fallback path)
 *
 * Auth model mirrors POST sibling: cookie/Bearer for browser/Mac app,
 * admin-bearer fallback for CLI/scripts. Cookie path iterates every
 * ant_browser_session value (RFC 6265 multi-cookie tolerance).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { detachPlanFromRoom } from '$lib/server/planRoomLinkStore';
import { broadcastPlanChanged } from '$lib/server/taskPlanRealtime';

function requirePlanRoomLinkAuth(request: Request): void {
  if (resolveCallerHandleAnyRoom(request)) return;
  try {
    requireAdminAuth(request);
    return;
  } catch {
    /* fall through */
  }
  throw error(401, 'browser-session, antchat Bearer, or admin-bearer required');
}

export const DELETE: RequestHandler = async ({ params, request }) => {
  requirePlanRoomLinkAuth(request);
  const planId = params.planId ?? '';
  const roomId = params.roomId ?? '';
  if (planId.length === 0) throw error(400, 'planId is required.');
  if (roomId.length === 0) throw error(400, 'roomId is required.');
  const result = detachPlanFromRoom({ planId, roomId });
  // Realtime: the detached room is no longer in listRoomsForPlan, so pass
  // it explicitly so its Plans panel refreshes to drop the link.
  if (result.removed) broadcastPlanChanged(planId, { action: 'detached' }, [roomId]);
  return json(result);
};
