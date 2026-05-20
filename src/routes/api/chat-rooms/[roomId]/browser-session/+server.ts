import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { addMembership, getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { getRoomMode } from '$lib/server/roomModesStore';

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length === 0) throw error(400, 'Body must be a JSON object.');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (failure) {
    if (failure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw failure;
  }
}

function requireSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) throw error(403, 'same-origin browser POST required');
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw error(403, 'same-origin browser POST required');
  }
  // GAP-55 follow-up (2026-05-14, JWPK Tailscale dogfood): protocol
  // comparison is unreliable across the SvelteKit adapter-node + Tailscale
  // TLS-termination boundary — adapter-node default-classifies the request
  // url as `https:` even when the browser-visible scheme + Origin header
  // are plain `http:`, which deadlocks every same-origin browser-session
  // POST behind a 403. The security invariant we actually want is
  // browser-supplied Origin.host MATCHES the request Host header (proves
  // the browser was on the same hostname:port the server is serving),
  // independent of which side terminates TLS. The Origin presence itself
  // already proves the request is browser-initiated (curl etc must opt
  // in by sending Origin). So we drop the protocol check and keep host
  // equality as the canonical same-origin signal.
  if (host !== url.host || originUrl.host !== host) {
    throw error(403, 'same-origin browser POST required');
  }
}

function buildSessionCookie(
  secret: string,
  roomId: string,
  expiresAtMs: number,
  nowMs: number,
  request: Request
): string {
  const maxAgeSeconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const parts = [
    `ant_browser_session=${secret}`,
    'HttpOnly',
    'SameSite=Strict',
    `Path=/api/chat-rooms/${roomId}`,
    `Max-Age=${maxAgeSeconds}`
  ];
  // GAP-55 follow-up (2026-05-14): the Secure flag must reflect the
  // BROWSER-VISIBLE scheme, not the server-side url.protocol (which the
  // adapter-node default classifies as https for every request even when
  // the browser is on plain http). A Secure cookie issued over http is
  // silently dropped by browsers, breaking the entire downstream SSE
  // auth chain. Source-of-truth for browser scheme is the Origin header
  // (verified to match Host by requireSameOrigin above).
  const originHeader = request.headers.get('origin');
  let originIsHttps = false;
  if (originHeader) {
    try {
      originIsHttps = new URL(originHeader).protocol === 'https:';
    } catch { /* fall through; Secure stays off */ }
  }
  if (originIsHttps) parts.push('Secure');
  return parts.join('; ');
}

export const POST: RequestHandler = async ({ params, request, url }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'URL roomId is required.');
  requireSameOrigin(request, url);

  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');
  const body = await parseRequiredJsonBody(request);
  const rawHandle = body.authorHandle;
  if (typeof rawHandle !== 'string' || rawHandle.trim().length === 0) {
    throw error(400, 'authorHandle must be a non-empty string.');
  }
  const authorHandle = normalizeHandle(rawHandle);
  if (!room.members.some((member) => member.handle === authorHandle)) {
    // JWPK msg_0dmc9bbiln + msg_23zhfticim (2026-05-19) — open-room
    // auto-join via browser-session mint. The pidChain path in
    // messages/+server.ts:99-114 already auto-joins for CLI callers
    // when roomMode is open; this closes the parallel browser path.
    // Strict 403 only stays in closed / heads-down rooms.
    const mode = getRoomMode(roomId);
    if (mode === 'closed' || mode === 'heads-down') {
      throw error(403, 'authorHandle is not a room member.');
    }
    // mode is brainstorm (open) — auto-join happens BELOW via the
    // lazy-create synthetic-terminal + addMembership block at lines
    // 132-141. That block runs whenever the handle has no terminal
    // binding for this room (which includes the just-auto-joined
    // stranger here), upserts the synthetic terminal FIRST, then
    // addMembership with the real id.
    //
    // Coord 0bbc7db note (real prod 500 path): the previous version
    // here addMembership'd with `terminal_id: ''` which violates the
    // room_memberships FK to terminals(id). Strangers entering a
    // brainstorm-mode room via the browser-session mint got 500. Fix
    // is just to remove the bad pre-emptive addMembership and let the
    // lazy-create path handle both the terminal AND the membership.
  }

  // GAP-55 (2026-05-14, JWPK Tailscale dogfood evidence): browser-only
  // operators (no `ant register` ever run from a CLI) hit this route to
  // claim a session for the room they're already a member of, but lack
  // a terminal binding so getTerminalIdByHandle returns null and the
  // strict 403 used to silently break the entire downstream SSE chain
  // (EventSource never authenticates → no real-time messages → JWPK
  // sees "I still need to refresh"). Lazy-create a synthetic browser
  // terminal + room-membership row here so the M3.6a-v1 identity gate
  // downstream accepts the browser session. The terminal is scoped per
  // (room, handle); no PID since the browser tab is the "process";
  // source='browser-session-default' distinguishes from CLI registers.
  if (!getTerminalIdByHandle(roomId, authorHandle)) {
    const syntheticTerminal = upsertTerminal({
      pid: 0,
      pid_start: `browser-session-${Date.now()}`,
      name: `browser-${roomId}-${authorHandle}`,
      source: 'browser-session-default',
      meta: { kind: 'browser-default', roomId, authorHandle }
    });
    addMembership({ room_id: roomId, handle: authorHandle, terminal_id: syntheticTerminal.id });
  }

  const nowMs = Date.now();
  const result = createBrowserSession({ roomId, authorHandle, nowMs });
  if (!result) throw error(403, 'browser session cannot be created.');
  const cookie = buildSessionCookie(
    result.browserSessionSecret,
    roomId,
    result.session.expires_at_ms,
    nowMs,
    request
  );

  return json({
    browserSession: {
      id: result.session.id,
      room_id: result.session.room_id,
      terminal_id: result.session.terminal_id,
      handle: result.session.handle,
      expires_at_ms: result.session.expires_at_ms
    }
  }, { status: 201, headers: { 'set-cookie': cookie } });
};
