/**
 * GET /api/vault
 *
 * Operator-only browse of archived rooms (post-Kill+Archive or post-room-
 * archive). Powers the OSS-tier /vault page (ratified via JWPK msg_u7r6znc3ec).
 *
 * Returns shape:
 *   { archives: Array<{
 *       roomId: string;
 *       name: string;
 *       summary: string;
 *       archivedAtMs: number | null;
 *       whoCreatedIt: string;
 *       messageCount: number;
 *       hasMineableContent: boolean;
 *     }> }
 *
 * messageCount + hasMineableContent surface up-front so the operator can
 * eyeball which archives are worth mining for memories. hasMineableContent
 * = messageCount >= 3 today; cheaper heuristic than running a digest pass
 * just to label the row.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listArchivedChatRooms } from '$lib/server/chatRoomStore';
import { listMessagesInRoom } from '$lib/server/chatMessageStore';
import { resolveBrowserSessionSecret } from '$lib/server/browserSessionStore';
import { isSuperAdmin } from '$lib/server/orgStore';

function getCookieValue(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const sep = trimmed.indexOf('=');
    if (sep === -1) continue;
    if (trimmed.slice(0, sep) === cookieName) {
      return decodeURIComponent(trimmed.slice(sep + 1));
    }
  }
  return null;
}

function requireOperatorBrowserSessionAnyRoom(request: Request): void {
  // Vault is a global operator surface — there's no roomId in the URL to
  // bind the cookie against. Accept any active browser session whose
  // resolved handle is @you. We probe one archived room id (if any) just
  // to satisfy resolveBrowserSessionSecret's room-binding signature, then
  // fall back to an unrestricted check via the same hash table.
  const cookie = getCookieValue(request, 'ant_browser_session');
  if (!cookie) throw error(403, 'Operator browser session required.');
  // Iterate archived rooms looking for ANY one the cookie resolves against.
  // If no archived rooms exist yet we can still admit by walking active
  // rooms separately — but in the vault context, no archived rooms means
  // the list response is just empty anyway, so we accept and let the
  // empty list flow through.
  const archives = listArchivedChatRooms();
  for (const archive of archives) {
    const resolved = resolveBrowserSessionSecret(cookie, archive.id);
    if (resolved && isSuperAdmin(resolved.handle)) return;
  }
  // No archived rooms or no cookie match — refuse. Operator should hit
  // /rooms first to mint a session; vault is gated on having at least one
  // archived room the operator owns.
  throw error(403, 'Operator browser session required.');
}

export const GET: RequestHandler = ({ request }) => {
  const archives = listArchivedChatRooms();
  // If the list is empty, skip the auth probe entirely — there's nothing
  // to gate. Operator gets an empty-state UI instead of a 403 misleading
  // them into thinking they're not signed in.
  if (archives.length === 0) {
    return json({ archives: [] });
  }
  requireOperatorBrowserSessionAnyRoom(request);

  const payload = archives.map((archive) => {
    const messages = listMessagesInRoom(archive.id);
    const messageCount = messages.length;
    return {
      roomId: archive.id,
      name: archive.name,
      summary: archive.summary,
      archivedAtMs: archive.archivedAtMs,
      whoCreatedIt: archive.whoCreatedIt,
      messageCount,
      hasMineableContent: messageCount >= 3
    };
  });

  return json({ archives: payload });
};
