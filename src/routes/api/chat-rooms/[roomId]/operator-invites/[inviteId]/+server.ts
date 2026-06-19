/**
 * DELETE /api/chat-rooms/[roomId]/operator-invites/[inviteId]
 *   → 204 on success / already-revoked (idempotent).
 *
 * Operator-only revoke. Wraps chatInviteStore.revokeInvite which
 * cascades to the linked tokens.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCookieValuesFromRequest } from '$lib/server/authGate';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { resolveBrowserSessionSecret } from '$lib/server/browserSessionStore';
import { isOperatorHandle } from '$lib/server/operatorHandle';
import { revokeInvite } from '$lib/server/chatInviteStore';

function requireOperatorBrowserSession(request: Request, roomId: string): void {
  const cookies = getCookieValuesFromRequest(request, 'ant_browser_session');
  if (cookies.length === 0) throw error(403, 'Operator browser session required.');
  let sawNonOperatorSession = false;
  for (const cookie of cookies) {
    const resolved = resolveBrowserSessionSecret(cookie, roomId);
    if (resolved && isOperatorHandle(resolved.handle)) return;
    if (resolved) sawNonOperatorSession = true;
  }
  if (sawNonOperatorSession) throw error(403, 'Only the operator can manage invites.');
  throw error(403, 'Operator browser session required.');
}

export const DELETE: RequestHandler = ({ params, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  requireOperatorBrowserSession(request, params.roomId);
  revokeInvite(params.inviteId);
  return new Response(null, { status: 204 });
};
