/**
 * GET /api/helper/handles — operator-gated list of the ANThandles the operator
 * OWNS. Drives the "Pair an app" dropdown (JWPK + fClaude 2026-06-12: a handle
 * you don't own should never even appear). The pairing endpoint enforces the
 * same rule server-side; this read is the convenience view, not the security.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { listHandlesOwnedBy } from '$lib/server/handleBindingsStore';
import { listAcceptedInviteHandles } from '$lib/server/chatInviteStore';

/**
 * The helper's pairable set (JWPK + fClaude 2026-06-12): the ANThandles that
 * ACCEPTED an invite (the real cli/mcp/api agents the colony onboarded),
 * intersected with the handles the operator OWNS. Not the raw handle registry —
 * an invite must have gone OUT and been ACCEPTED for it to be pairable.
 */
export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request)) {
    throw error(401, 'operator login required');
  }
  const operator = getOperatorHandle();
  const owned = new Set(listHandlesOwnedBy(operator).map((h) => h.handle));
  const handles = listAcceptedInviteHandles()
    .filter((a) => owned.has(a.handle))
    .map((a) => a.handle);
  return json({ handles });
};
