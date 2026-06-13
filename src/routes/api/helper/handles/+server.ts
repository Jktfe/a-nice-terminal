/**
 * GET /api/helper/handles — operator-gated list of the LIVE ANThandles in the
 * colony, for the "Pair an app" dropdown.
 *
 * JWPK 2026-06-13: "show the ANThandles that are LIVE — the ones on the
 * terminals page AND the CLIs / MCPs that are live." Shares listLiveColonyHandles
 * with the mint gate so the dropdown and the gate can never disagree (the old
 * invite-accepted-vs-owners split was the over-correction that 403'd @fableCD).
 * The operator owns their own colony — every live handle here is pairable; the
 * operator browser session IS the authority.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import { listLiveColonyHandles } from '$lib/server/liveColonyHandles';

export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request)) {
    throw error(401, 'operator login required');
  }
  return json({ handles: await listLiveColonyHandles() });
};
