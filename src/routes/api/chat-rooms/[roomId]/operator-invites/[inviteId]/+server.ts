/**
 * DELETE /api/chat-rooms/[roomId]/operator-invites/[inviteId]
 *   → 204 on success / already-revoked (idempotent).
 *
 * Operator-only revoke. Wraps chatInviteStore.revokeInvite which
 * cascades to the linked tokens.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { resolveBrowserSessionSecret } from '$lib/server/browserSessionStore';
import { OPERATOR_HANDLE } from '$lib/server/allowlistGuard';
import { revokeInvite } from '$lib/server/chatInviteStore';

function getCookieValue(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    if (trimmed.slice(0, separatorIndex) === cookieName) {
      return decodeURIComponent(trimmed.slice(separatorIndex + 1));
    }
  }
  return null;
}

function requireOperatorBrowserSession(request: Request, roomId: string): void {
  const cookie = getCookieValue(request, 'ant_browser_session');
  if (!cookie) throw error(403, 'Operator browser session required.');
  const resolved = resolveBrowserSessionSecret(cookie, roomId);
  if (!resolved) throw error(403, 'Operator browser session required.');
  if (resolved.handle !== OPERATOR_HANDLE) {
    throw error(403, 'Only the operator can manage invites.');
  }
}

export const DELETE: RequestHandler = ({ params, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  requireOperatorBrowserSession(request, params.roomId);
  revokeInvite(params.inviteId);
  return new Response(null, { status: 204 });
};
