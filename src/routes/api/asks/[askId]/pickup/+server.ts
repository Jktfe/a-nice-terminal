/**
 * GET /api/asks/:askId/pickup
 *   → 200 { pickup: AskPickupSummary }
 *   → 400 missing askId
 *   → 401 no auth
 *   → 403 caller is not a member of the originating room
 *   → 404 ask not found
 *
 * Returns a 'who picked up + acted on this answered ask' summary
 * (count + distinct agents + first-message-after-answer preview).
 *
 * JWPK ask-pickup notice task 3947e563 (2026-05-19) — surface JWPK
 * visibility into what happened after he answered an ask.
 *
 * Auth (msg_53bpcfqe9j pre-launch code review): the pickup summary
 * leaks the first-message body preview + the distinct agent handles
 * that posted in the originating room. That's room-private data.
 * Gating: caller must be a member of the ask's originating room, OR
 * admin-bearer.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pickupSummaryForAsk } from '$lib/server/askPickupStore';
import { findAskById } from '$lib/server/askStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';

export const GET: RequestHandler = ({ params, request }) => {
  const askId = params.askId ?? '';
  if (askId.length === 0) throw error(400, 'askId required');

  const ask = findAskById(askId);
  if (!ask) {
    // Fail-closed: return 404 even if caller is anonymous so we don't
    // leak ask-existence to unauthenticated probes.
    throw error(404, 'ask not found');
  }

  // Privacy gate: caller is a member of the originating room, OR
  // admin-bearer. Anonymous → 401; non-member → 403.
  const callerHandle = resolveCallerHandleAnyRoom(request);
  if (!callerHandle) {
    try {
      requireAdminAuth(request);
    } catch {
      throw error(401, 'session or admin-bearer required to read pickup summary');
    }
  } else {
    const room = findChatRoomById(ask.roomId);
    const isMember = room?.members.some(
      (m) => m.handle.toLowerCase() === callerHandle.toLowerCase()
    );
    if (!isMember) {
      throw error(403, `pickup summary is only readable by members of room ${ask.roomId}`);
    }
  }

  return json({ pickup: pickupSummaryForAsk(askId) });
};
