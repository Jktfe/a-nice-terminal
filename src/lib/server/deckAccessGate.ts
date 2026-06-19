/**
 * deckAccessGate — room-membership + password access control for decks.
 *
 * Decks are room-scoped. By default only room members can view them.
 * A deck creator may set an `accessPassword` to allow external sharing
 * via URL with ?password= query parameter.
 */

import { resolveBrowserSessionSecretIgnoringRoom } from './browserSessionStore';
import { isHandleMemberOfRoom } from './membershipStore';
import { getCookieValuesFromRequest } from './authGate';

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
  for (const cookieSecret of getCookieValuesFromRequest(args.request, 'ant_browser_session')) {
    const resolved = resolveBrowserSessionSecretIgnoringRoom(cookieSecret);
    if (resolved && isHandleMemberOfRoom(args.deckRoomId, resolved.handle)) {
      return { allowed: true };
    }
  }

  // 3. No password, no valid room cookie → deny.
  return { allowed: false, reason: 'Deck requires room membership or a valid password.' };
}
