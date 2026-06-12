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
import { listAcceptedInviteHandles } from '$lib/server/chatInviteStore';

/**
 * The helper's pairable set (JWPK + fClaude 2026-06-12): the ANThandles that
 * ACCEPTED an invite the OPERATOR issued (the real cli/mcp/api agents the
 * operator onboarded). Ownership flows from the invite — the inviter owns the
 * invitee — so this is "accepted ∩ owned" without depending on a separately-
 * populated owners table; any agent that accepts the operator's invite is in.
 */
export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request)) {
    throw error(401, 'operator login required');
  }
  const operator = getOperatorHandle();
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const a of listAcceptedInviteHandles()) {
    if (a.invitedBy === operator && !seen.has(a.handle)) {
      seen.add(a.handle);
      handles.push(a.handle);
    }
  }
  return json({ handles });
};
