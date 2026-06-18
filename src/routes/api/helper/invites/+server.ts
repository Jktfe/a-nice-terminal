/**
 * GET /api/helper/invites — the invite REGISTER (JWPK 2026-06-12): every invite
 * the operator has issued (cli/mcp/api/web), across rooms, with who has accepted
 * it and what's still pending. Operator-gated; pure surfacing of existing data.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession, tryAntchatOperatorBearer } from '$lib/server/chatRoomAuthGate';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { listInviteRegisterForOperator } from '$lib/server/chatInviteStore';

export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request) && !tryAntchatOperatorBearer(request)) {
    throw error(401, 'operator login required');
  }
  const invites = listInviteRegisterForOperator(getOperatorHandle());
  return json({ invites });
};
