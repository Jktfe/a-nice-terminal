/**
 * POST /api/chat-invites/:inviteId/revoke
 *
 * Admin-bearer auth. Calls chatInviteStore.revokeInvite which cascades to
 * derived tokens (existing store behaviour, lock unchanged here).
 *
 * Status semantics:
 *   200 → invite revoked (idempotent: same response whether newly revoked or
 *         already in revoked state, matches REST revoke convention).
 *   401 → admin bearer missing or wrong.
 *   404 → no such invite id.
 *   503 → ANT_ADMIN_TOKEN env not set (fail-closed by default).
 *
 * Slice: M3.7b. Route lives alongside /exchange under [inviteId] for
 * discoverability + log/caching parallelism.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { revokeInvite } from '$lib/server/chatInviteStore';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';

export const POST: RequestHandler = async ({ params, request }) => {
  requireAdminAuth(request);
  const inviteId = params.inviteId;
  if (!inviteId) throw error(400, 'inviteId required');
  const revoked = revokeInvite(inviteId);
  if (!revoked) throw error(404, 'invite not found');
  return json({ invite_id: inviteId, revoked: true });
};
