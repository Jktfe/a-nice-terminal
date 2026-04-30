// ANT v3 — Server Hooks
// Handles WebSocket upgrades and middleware

import type { Handle } from '@sveltejs/kit';
import { resolveToken } from '$lib/server/room-invites';

// Public invite-exchange path — no Tailnet IP and no master API key required.
// Auth is enforced inside the route by the per-invite password gate.
const EXCHANGE_RE = /^\/api\/sessions\/[^/]+\/invites\/[^/]+\/exchange$/;

// URL prefixes that map to a room id. Used to verify that a presented room
// token authorises the URL it's being used against.
const ROOM_URL_PATTERNS = [
  /^\/api\/sessions\/([^/]+)/,  // primary HTTP API
  /^\/mcp\/room\/([^/]+)/,      // remote MCP transport (P3)
];

function urlRoomId(pathname: string): string | null {
  for (const re of ROOM_URL_PATTERNS) {
    const m = pathname.match(re);
    if (m) return m[1];
  }
  return null;
}

// Three states a Bearer header can be in for /api/* requests:
//   - 'admin'         → it's the master ANT_API_KEY, full access
//   - 'room-scoped'   → it's a valid room token AND the URL targets its room
//   - 'wrong-room'    → it's a valid room token but the URL targets a
//                       different room — explicit 403, do NOT fall through
//                       to the same-origin shortcut and let the request slip
//   - 'none'          → no Bearer, or an unknown one
type BearerState =
  | { kind: 'admin' }
  | { kind: 'room-scoped'; roomId: string; tokenKind: string | null }
  | { kind: 'wrong-room' }
  | { kind: 'none' };

function extractBearer(event: Parameters<Handle>[0]['event']): string {
  const auth = event.request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  // MCP clients that can't set headers may pass the token via ?token=.
  // Restricted to /mcp/* paths so we don't broaden the API auth surface.
  if (event.url.pathname.startsWith('/mcp/')) {
    const q = event.url.searchParams.get('token');
    if (q) return q;
  }
  return '';
}

function classifyBearer(event: Parameters<Handle>[0]['event']): BearerState {
  const bearer = extractBearer(event);
  if (!bearer) return { kind: 'none' };
  if (process.env.ANT_API_KEY && bearer === process.env.ANT_API_KEY) return { kind: 'admin' };
  const resolved = resolveToken(bearer);
  if (!resolved) return { kind: 'none' };
  const targetRoom = urlRoomId(event.url.pathname);
  if (!targetRoom) return { kind: 'wrong-room' };
  if (targetRoom !== resolved.invite.room_id) return { kind: 'wrong-room' };
  return {
    kind: 'room-scoped',
    roomId: resolved.invite.room_id,
    tokenKind: resolved.token.kind ?? null,
  };
}

export const handle: Handle = async ({ event, resolve }) => {
  const isExchange = EXCHANGE_RE.test(event.url.pathname);
  const bearer = isExchange ? { kind: 'none' as const } : classifyBearer(event);

  if (bearer.kind === 'wrong-room') {
    return new Response(JSON.stringify({ error: 'Token does not authorise this room' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const scopedRoomId = bearer.kind === 'room-scoped' ? bearer.roomId : null;
  const scopedTokenKind = bearer.kind === 'room-scoped' ? bearer.tokenKind : null;
  const isPublic = isExchange || scopedRoomId !== null || bearer.kind === 'admin';

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
  if (scopedRoomId) {
    (event.locals as Record<string, unknown>).roomScope = {
      roomId: scopedRoomId,
      kind: scopedTokenKind,
    };
  }
  return resolve(event);
};

