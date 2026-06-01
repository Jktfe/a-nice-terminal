/**
 * deckAccessGate — room-membership + password access control for decks.
 *
 * Decks are room-scoped. By default only room members can view them.
 * A deck creator may set an `accessPassword` to allow external sharing
 * via URL with ?password= query parameter.
 */

import { resolveBrowserSessionSecretIgnoringRoom } from './browserSessionStore';
import { isHandleActiveMemberOfRoom as v02IsHandleActiveMemberOfRoom } from './v02MembershipsStore';

function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      const raw = trimmed.slice(eq + 1);
      try { return decodeURIComponent(raw); } catch { return raw; }
    }
  }
  return null;
}

// M9d cut-over phase 3: deck access gate reads membership from v0.2
// memberships rather than chat_room_members. Both surfaces are
// dual-written via v02ChatRoomBridge so the result is identical, and
// v0.2 is the new source of truth.
function isHandleMemberOfRoom(roomId: string, handle: string): boolean {
  return v02IsHandleActiveMemberOfRoom(roomId, handle);
}

export function resolveDeckAccess(args: {
  deckRoomId: string;
  deckAccessPassword: string | null;
  request: Request;
  url: URL;
}): { allowed: true } | { allowed: false; reason: string } {
  // 1. Password bypass — anyone with the correct password can access.
  const providedPassword = args.url.searchParams.get('password');
  if (providedPassword !== null && providedPassword !== '') {
    if (args.deckAccessPassword !== null && providedPassword === args.deckAccessPassword) {
      return { allowed: true };
    }
    // Wrong password — fail fast, don't fall through to membership check.
    return { allowed: false, reason: 'Incorrect deck password.' };
  }

  // 2. Identity-then-membership check via the browser-session cookie.
  //    The session may have been minted for a different room (cookies
  //    are per-room) — that's fine. What matters is whether the
  //    resolved handle is a member of THIS deck's room. JWPK
  //    2026-05-17 in the ANT artefacts room: previously the gate
  //    required the cookie's room === deck's room, which 403'd
  //    legitimate cross-room shares.
  const cookieSecret = getCookieValue(args.request, 'ant_browser_session');
  if (cookieSecret !== null) {
    const resolved = resolveBrowserSessionSecretIgnoringRoom(cookieSecret);
    if (resolved && isHandleMemberOfRoom(args.deckRoomId, resolved.handle)) {
      return { allowed: true };
    }
  }

  // 3. No password, no valid room cookie → deny.
  return { allowed: false, reason: 'Deck requires room membership or a valid password.' };
}
