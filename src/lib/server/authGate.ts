/**
 * authGate — M3.6a-v1 T2 shared 3-tier identity resolver.
 *
 * Used by chat-room write routes that don't carry a client-supplied
 * authorHandle to compare against (members POST/DELETE, discussions POST).
 * /messages POST keeps its own resolveMessageAuthorHandle because it
 * additionally enforces clientAuthorHandle === resolved (Q3 anti-spoof).
 *
 * Precedence (locked by M3.6a-v1 design contract Q2 + B3):
 *   1. Cookie ant_browser_session present → resolve; PRESENT-BUT-INVALID
 *      always 403s, never falls through (anti-spoof of stolen cookies +
 *      forged pidChain combinations).
 *   2. Cookie absent → parse pidChain from rawBody; resolved handle wins.
 *   3. Neither resolves → applyDeprecationOrThrow ("warning phase" returns
 *      the X-Auth-Deprecation header; "strict phase" throws 403 + Q3 hint).
 */
import { error } from '@sveltejs/kit';
import { timingSafeEqual } from 'crypto';
import { parsePidChainFromBody, resolveServerSideHandle } from './identityGate';
import {
  resolveBrowserSessionSecret,
  resolveBrowserSessionSecretIgnoringRoom,
  touchBrowserSessionLastSeen
} from './browserSessionStore';
import { applyDeprecationOrThrow, AUTH_DEPRECATION_HINT_BODY } from './authDeprecation';
import { lookupTerminalByPidChain } from './terminalsStore';
import { getOperatorHandle } from './operatorHandle';
import {
  bearerTokenFromHeader,
  resolveToken as resolveAntchatToken,
  userShapeForEmail as antchatUserShapeForEmail
} from './antchatAuthStore';

/**
 * Try to resolve an antchat Bearer token from the request's Authorization
 * header. Returns the handle to attribute writes to, or null if no valid
 * antchat token is present.
 *
 * This bridges the Mac antchat app's `Authorization: Bearer <token>`
 * (issued by POST /api/auth/login) into the existing identity-gate that
 * /api/chat-rooms/* endpoints use — so signed-in Mac users can read +
 * write rooms without a separate cookie/pidChain ceremony.
 *
 * Added per JWPK msg_gqie1ekg4e demo-pressure ("let's get this app
 * working!!!") — the auth-bridge slice flagged in msg_gh5hpp7xm0.
 */
function resolveAntchatBearer(request: Request): string | null {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return null;
  const record = resolveAntchatToken(token);
  if (!record) return null;
  // Map the stored email → canonical handle the antchat client sees.
  return antchatUserShapeForEmail(record.email).handle;
}

export type AuthGateRouteLabel =
  | 'messages-post'
  | 'discussions-post'
  | 'members-post'
  | 'members-delete';

export type AuthGateResult =
  | { kind: 'identity'; handle: string; clearStaleBrowserCookie?: boolean }
  | { kind: 'legacy'; warningHeader: { name: string; value: string }; clearStaleBrowserCookie?: boolean };

export function getCookieValueFromRequest(request: Request, cookieName: string): string | null {
  const values = getCookieValuesFromRequest(request, cookieName);
  return values.length === 0 ? null : values[0];
}

/**
 * Browsers can send MULTIPLE cookies with the same name when paths differ
 * (e.g. /api/auth/demo-login mints Path=/ + /api/chat-rooms/{id}/browser-session
 * mints Path=/api/chat-rooms/{id}). RFC 6265 §5.4 orders narrower paths first.
 * Auth resolvers should try EVERY matching cookie against the room-bound
 * secret store so a Path=/ demo-login cookie that's bound to a different
 * room (or expired) cannot mask a still-valid Path=/api/chat-rooms/{id}
 * cookie. Fixes the antv4 re-auth bug (JWPK msg_y0p7c8j3sr + msg_rlcmtdhngu,
 * 2026-05-19).
 */
export function getCookieValuesFromRequest(request: Request, cookieName: string): string[] {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return [];
  const matches: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    if (trimmed.slice(0, separatorIndex) === cookieName) {
      const rawValue = trimmed.slice(separatorIndex + 1);
      try {
        matches.push(decodeURIComponent(rawValue));
      } catch {
        matches.push(rawValue);
      }
    }
  }
  return matches;
}

export function resolveCallerIdentityOrDeprecate(
  routeLabel: AuthGateRouteLabel,
  roomId: string,
  request: Request,
  rawBody: unknown
): AuthGateResult {
  // antchat Mac app Bearer-token path — tried FIRST so signed-in Mac
  // users never fall through to deprecation warnings or 403s on writes.
  // The Bearer token only exists if /api/auth/login issued it against
  // the dev-users.json allowlist, so presence == authentic identity.
  const antchatHandle = resolveAntchatBearer(request);
  if (antchatHandle) {
    return { kind: 'identity', handle: antchatHandle };
  }
  // GAP-53 Fix Shape B mirror (2026-05-14, canonical RQO32 greenlight):
  // cookie present but INVALID (stale/expired/wrong-room/malformed) falls
  // through to step 2 + step 3 during the M3.6a-v1 warning phase rather
  // than 403'ing silently. Route handlers consume clearStaleBrowserCookie
  // and emit a Max-Age=0 Set-Cookie so the browser drops the bad value.
  // Mismatched-handle on a VALID cookie path is N/A here (this resolver
  // doesn't compare against a client-supplied handle); the strict variant
  // below also keeps cookie-invalid 403 since its consumers (discussions,
  // chair handoff, screenshots) have no deprecation-gate to fall through.
  // After 2026-05-28 strict-flip, step-3 applyDeprecationOrThrow throws
  // 403 with the Q3 hint, preserving M3.6a-v1 invariants.
  let clearStaleBrowserCookie = false;
  const cookieSecrets = getCookieValuesFromRequest(request, 'ant_browser_session');
  for (const cookieSecret of cookieSecrets) {
    const resolved = resolveBrowserSessionSecret(cookieSecret, roomId);
    if (resolved) {
      touchBrowserSessionLastSeen(resolved.session_id);
      return { kind: 'identity', handle: resolved.handle };
    }
  }
  if (cookieSecrets.length > 0) clearStaleBrowserCookie = true;
  const pidChain = parsePidChainFromBody(rawBody);
  const handle = resolveServerSideHandle(roomId, pidChain);
  if (handle) {
    return clearStaleBrowserCookie
      ? { kind: 'identity', handle, clearStaleBrowserCookie: true }
      : { kind: 'identity', handle };
  }
  const warningHeader = applyDeprecationOrThrow(routeLabel);
  return {
    kind: 'legacy',
    warningHeader: { name: warningHeader.headerName, value: warningHeader.headerValue },
    ...(clearStaleBrowserCookie && { clearStaleBrowserCookie: true })
  };
}

/** GAP-53 (2026-05-14): build the Set-Cookie Max-Age=0 header value
 *  route handlers should write when the auth result carries
 *  clearStaleBrowserCookie. Centralised so all 3 cookie-aware routes
 *  emit the same shape. */
export function buildStaleBrowserCookieClearHeader(roomId: string): string {
  return `ant_browser_session=; HttpOnly; SameSite=Strict; Path=/api/chat-rooms/${roomId}; Max-Age=0`;
}

/**
 * Strict-only variant for routes that have NO legacy clientAuthorHandle
 * fallback to deprecate gracefully. Missing identity ALWAYS throws 403 with
 * the Q3 hint body, regardless of deprecation window cutover. Discussions
 * POST is the canonical caller (locked design contract delta-5 B2: no
 * warning phase, no client-supplied attribution to preserve).
 *
 * Cookie-first invariant is preserved (anti-spoof for stolen cookies +
 * forged pidChain combinations).
 */
export function resolveCallerIdentityStrict(roomId: string, request: Request, rawBody: unknown): string {
  // antchat Mac app Bearer-token path — tried first so signed-in Mac
  // users authenticate writes without cookie/pidChain ceremony.
  const antchatHandle = resolveAntchatBearer(request);
  if (antchatHandle) return antchatHandle;

  const cookieSecrets = getCookieValuesFromRequest(request, 'ant_browser_session');
  if (cookieSecrets.length > 0) {
    for (const cookieSecret of cookieSecrets) {
      const resolved = resolveBrowserSessionSecret(cookieSecret, roomId);
      if (resolved) {
        touchBrowserSessionLastSeen(resolved.session_id);
        return resolved.handle;
      }
    }
    // Anti-spoof invariant: cookies present but NONE resolved — 403 immediately.
    // Strict callers (discussions, chair handoff, screenshots) deliberately
    // do NOT fall through to pidChain here, to prevent a stolen cookie +
    // forged pidChain combination from authenticating.
    throw error(403, 'Invalid browser session.');
  }
  const pidChain = parsePidChainFromBody(rawBody);
  const handle = resolveServerSideHandle(roomId, pidChain);
  if (handle) return handle;
  throw error(403, AUTH_DEPRECATION_HINT_BODY);
}

/**
 * Strict variant for routes with NO room context — confirms the caller's
 * pidChain resolves to a registered terminal (any room, or none).
 * Used by global-scope writes like /api/chair-enabled per M4.4 Q4 — the
 * chair toggle is instance-wide, so the gate is "are you a registered
 * caller?" rather than "are you a member of room X?".
 *
 * Cookie-present-invalid still fails closed; cookie path requires a room
 * scope so this helper rejects browser-session cookies (callers can't use
 * cookie auth for global routes). pidChain path returns the resolved
 * terminal id (not a handle, since there's no room scope).
 */
export function resolveCallerTerminalStrict(request: Request, rawBody: unknown): string {
  const cookieSecret = getCookieValueFromRequest(request, 'ant_browser_session');
  if (cookieSecret !== null) {
    throw error(403, 'Browser session cookies cannot authenticate instance-scope writes; supply a pidChain.');
  }
  const pidChain = parsePidChainFromBody(rawBody);
  if (pidChain.length === 0) throw error(403, AUTH_DEPRECATION_HINT_BODY);
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) throw error(403, AUTH_DEPRECATION_HINT_BODY);
  return terminal.id;
}

/**
 * Cross-room cookie identity for routes that span rooms (e.g. plan↔room
 * attach, which writes to one route but binds two rooms). Resolves the
 * caller's handle from ANY valid ant_browser_session cookie regardless of
 * which room the cookie was minted for. Used in place of admin-bearer when
 * the operation is "logged-in browser user does X across their rooms" —
 * the cookie's existence proves authentication; the route handler enforces
 * cross-resource authorization (e.g. "is this user a member of the target
 * room?").
 *
 * Falls back to antchat Bearer (Mac app) and pidChain (CLI) so the same
 * route works from browser, Mac app, and CLI fleet.
 *
 * Returns null when no identity could be resolved — caller decides whether
 * to 403 or allow anonymous (most callers should 403).
 */
export function resolveCallerHandleAnyRoom(request: Request): string | null {
  const antchatHandle = resolveAntchatBearer(request);
  if (antchatHandle) return antchatHandle;
  const cookieSecrets = getCookieValuesFromRequest(request, 'ant_browser_session');
  for (const cookieSecret of cookieSecrets) {
    const resolved = resolveBrowserSessionSecretIgnoringRoom(cookieSecret);
    if (resolved) {
      touchBrowserSessionLastSeen(resolved.session_id);
      return resolved.handle;
    }
  }
  return null;
}

/**
 * CVE FIX B (2026-05-20) — closes security-audit-2026-05-19.md Finding #2.
 *
 * Terminal sub-routes (kill, agent-launch, …) previously read `callerHandle`
 * directly from the request body and trusted the claim, which let any caller
 * spoof `@you` and bypass the allowlistGuard. This helper replaces the
 * body-derived path with a server-resolved identity:
 *
 *   1. cookie (ant_browser_session) or antchat Bearer → the resolved handle.
 *   2. admin Bearer (ANT_ADMIN_TOKEN) → the operator handle (@you), since
 *      anyone holding the admin token is by definition the box operator on
 *      terminal sub-routes (which act on local panes / processes).
 *   3. otherwise null — caller should 401.
 *
 * Used by routes that need both authentication AND a handle to attribute
 * the action to (e.g. who is killing the terminal, who is launching the
 * agent). Mirrors the cookie-or-admin-bearer gate in /escape and /input
 * (CVE FIX A) but additionally returns the caller handle.
 *
 * NOTE: terminal sub-routes intentionally map admin-bearer → @you (not the
 * `@admin` sentinel used by chatRoomAuthGate). For LOCAL operator actions
 * (kill panes / launch agents on the host) the admin-token holder IS the
 * operator, and the kill route's bare-pane branch requires == OPERATOR_HANDLE.
 */
export function resolveTerminalCallerHandle(request: Request): string | null {
  const cookieOrBearer = resolveCallerHandleAnyRoom(request);
  if (cookieOrBearer) return cookieOrBearer;
  const configured = process.env.ANT_ADMIN_TOKEN;
  if (configured && configured.length > 0) {
    const header = request.headers.get('authorization') ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (supplied.length > 0) {
      const a = Buffer.from(supplied);
      const b = Buffer.from(configured);
      // Admin-token holder IS the operator. Resolve to the configured operator
      // handle so downstream superadmin / operator checks recognise it.
      if (a.length === b.length && timingSafeEqual(a, b)) return getOperatorHandle();
    }
  }
  return null;
}
