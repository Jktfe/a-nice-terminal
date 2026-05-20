/**
 * GET /api/chat-invites/:inviteId/summary — PUBLIC invite preview.
 *
 * No admin auth: the invite-id itself is the capability (same trust model
 * as the exchange endpoint, which is password-gated not admin-gated). A
 * colleague holding the invite link needs to see WHAT they're joining
 * (room label, permitted kinds, whether it's still live) BEFORE typing
 * the password. Unblocks B2-2 /r/[inviteId] invite page.
 *
 *   → 200 { inviteId, roomId, label, kindsAllowed, revoked }
 *   → 404 invite not found (unknown id collapsed — never leaks existence
 *         vs revoked-vs-other beyond the public preview fields)
 *
 * NEVER echoes password_hash, failed_attempts, last_failed_at, or any
 * token data (per the canonical secret-never-leaks discipline).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInvitePreview } from '$lib/server/chatInviteStore';

export const GET: RequestHandler = async ({ params }) => {
  const inviteId = params.inviteId ?? '';
  if (inviteId.length === 0) throw error(400, 'URL inviteId is required.');
  const preview = getInvitePreview(inviteId);
  if (!preview) throw error(404, 'invite not found');
  return json(preview);
};
