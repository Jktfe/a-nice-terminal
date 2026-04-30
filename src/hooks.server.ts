// ANT v3 — Server Hooks
// Handles WebSocket upgrades and middleware

import type { Handle } from '@sveltejs/kit';
import { resolveToken } from '$lib/server/room-invites';

// Public invite-exchange path — no Tailnet IP and no master API key required.
// Auth is enforced inside the route by the per-invite password gate.
const EXCHANGE_RE = /^\/api\/sessions\/[^/]+\/invites\/[^/]+\/exchange$/;

// Returns the room id this request is scoped to via a per-room bearer token,
// or null if no valid token is presented. The token grants access only to
// /api/sessions/<roomId>/* (and the WS upgrade for that room).
function roomScopeFor(event: Parameters<Handle>[0]['event']): string | null {
  const auth = event.request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!bearer) return null;
  const resolved = resolveToken(bearer);
  if (!resolved) return null;
  // Token only authorises requests targeting its own room.
  const m = event.url.pathname.match(/^\/api\/sessions\/([^/]+)/);
  if (!m || m[1] !== resolved.invite.room_id) return null;
  return resolved.invite.room_id;
}

export const handle: Handle = async ({ event, resolve }) => {
  const isExchange = EXCHANGE_RE.test(event.url.pathname);
  const scopedRoomId = isExchange ? null : roomScopeFor(event);
  const isPublic = isExchange || scopedRoomId !== null;

  // Tailscale IP check (optional — only enforce if ANT_TAILSCALE_ONLY is set).
  // Public routes bypass: invite exchange has its own password gate; room-token
  // requests have already proven possession of an unrevoked bearer.
  if (process.env.ANT_TAILSCALE_ONLY === 'true' && !isPublic) {
    const ip = event.request.headers.get('x-forwarded-for') ||
               event.getClientAddress();
    const isTailscale = ip != null && (ip.startsWith('100.') || ip === '127.0.0.1' || ip === '::1');
    if (!isTailscale) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // API key check — enforced for external API calls only, not browser UI (same-origin)
  // or room-token-scoped requests (a narrower bearer beats the master key).
  const apiKey = process.env.ANT_API_KEY;
  if (apiKey && event.url.pathname.startsWith('/api/') && !isPublic) {
    const origin = event.request.headers.get('origin');
    const isSameOrigin = origin === event.url.origin || !origin;
    if (!isSameOrigin) {
      const provided = event.request.headers.get('authorization')?.replace('Bearer ', '') ||
                       event.request.headers.get('x-api-key') ||
                       event.url.searchParams.get('apiKey');
      if (provided !== apiKey) {
        return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  // P2b will read this in route handlers to enforce per-room scope on writes.
  // Wrapped to avoid TS noise in repos without an app.d.ts Locals declaration.
  if (scopedRoomId) (event.locals as Record<string, unknown>).roomScope = { roomId: scopedRoomId };
  return resolve(event);
};

