/**
 * GET /api/helper/handles — operator-gated list of the ANThandles the operator
 * OWNS. Drives the "Pair an app" dropdown (JWPK + fClaude 2026-06-12: a handle
 * you don't own should never even appear). The pairing endpoint enforces the
 * same rule server-side; this read is the convenience view, not the security.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession, tryAntchatOperatorBearer } from '$lib/server/chatRoomAuthGate';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { listHandlesOwnedBy } from '$lib/server/handleBindingsStore';

export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request) && !tryAntchatOperatorBearer(request)) {
    throw error(401, 'operator login required');
  }
  const operator = getOperatorHandle();
  const handles = listHandlesOwnedBy(operator).map((h) => h.handle);
  return json({ handles });
};
