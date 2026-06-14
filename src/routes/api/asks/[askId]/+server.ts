/**
 * GET /api/asks/:askId → one ask by id
 *
 * Task #130 fix: adds the missing single-ask GET route.
 *
 * rv1 data-scoping fix: this returned ANY ask by id with no auth, leaking
 * asks from rooms the caller is not in. The ask carries a roomId, so we now
 * load that room and run it through the same read gate every room-scoped
 * read uses (membership / admin-bearer containment). A caller who cannot
 * read the host room gets 404 — indistinguishable from a non-existent ask,
 * so the id space isn't probeable.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findAskById } from '$lib/server/askStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = async ({ params, request }) => {
  const ask = findAskById(params.askId);
  if (!ask) throw error(404, 'Ask not found.');
  const room = findChatRoomById(ask.roomId);
  // Host room missing (deleted/archived) → treat as not found rather than
  // leaking an orphaned ask.
  if (!room) throw error(404, 'Ask not found.');
  try {
    await requireChatRoomReadAccess(request, room);
  } catch (cause) {
    // requireChatRoomReadAccess throws 401 (no identity) or 404 (not a
    // member). Collapse the not-a-member 404 to "Ask not found" so the
    // response shape matches the genuine missing-ask case; preserve 401.
    const status = (cause as { status?: number })?.status;
    if (status === 404) throw error(404, 'Ask not found.');
    throw cause;
  }
  return json({ ask });
};
