/**
 * POST /api/auth/accounts-login
 *
 * Real browser login via accounts.antonline.dev (Better Auth) — the org/user
 * authority. Flow:
 *   1. Forward email+password to the accounts Better-Auth email sign-in.
 *   2. Validate the returned session token against accounts `/api/auth/me`
 *      (resolveAccountsBearerIdentity).
 *   3. Authorise: the resolved account email must be the configured operator
 *      (ANT_OPERATOR_EMAIL, falling back to the existing demo/login email) so a
 *      random accounts user can't assume the operator identity.
 *   4. Mint a local browser session bound to the operator handle
 *      (getOperatorHandle) — reusing the same session machinery the existing
 *      login uses, so everything downstream is unchanged.
 *
 * The legacy /api/auth/demo-login (stored-user) route is intentionally left in
 * place as a fallback until this path is verified end-to-end (verify-before-
 * delete — never remove the working login before the new one is proven).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { accountsBaseUrl } from '$lib/server/accountsProxy';
import { resolveAccountsBearerIdentity } from '$lib/server/accountsBearerIdentity';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { addMembership, getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { getOperatorEmail, setOperatorEmail } from '$lib/server/operatorEmail';

const DEFAULT_LANDING_ROOM = 'fnokx03pud';

function landingRoomId(): string {
  return (
    process.env.ANT_BROWSER_LOGIN_ROOM_ID ||
    process.env.ANT_DEMO_ROOM_ID ||
    DEFAULT_LANDING_ROOM
  );
}

function buildSessionCookie(secret: string, expiresAtMs: number, nowMs: number, request: Request): string {
  const maxAgeSeconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const parts = [`ant_browser_session=${secret}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSeconds}`];
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).protocol === 'https:') parts.push('Secure');
    } catch {
      /* keep Secure off when origin is unparseable */
    }
  }
  return parts.join('; ');
}

/** Better Auth returns the session token in the JSON body and/or a Set-Cookie. */
function extractSessionToken(body: unknown, setCookie: string | null): string | null {
  if (body && typeof body === 'object') {
    const t = (body as { token?: unknown }).token;
    if (typeof t === 'string' && t.length > 0) return t;
    const sess = (body as { session?: { token?: unknown } }).session;
    if (sess && typeof sess.token === 'string' && sess.token.length > 0) return sess.token;
  }
  if (setCookie) {
    const m = setCookie.match(/(?:^|[;,\s])(?:better-auth\.)?session_token=([^;]+)/i);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'invalid JSON body');
  }
  const email = body?.email;
  const password = body?.password;
  if (typeof email !== 'string' || typeof password !== 'string' || email.length === 0 || password.length === 0) {
    throw error(400, 'email + password required');
  }

  // 1. accounts Better-Auth email sign-in
  const accountsOrigin = accountsBaseUrl();
  let signin: Response;
  try {
    signin = await fetch(`${accountsOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: accountsOrigin },
      body: JSON.stringify({ email, password, rememberMe: true })
    });
  } catch {
    throw error(502, 'accounts auth unreachable');
  }
  if (!signin.ok) throw error(401, 'invalid email or password');

  const signinBody = await signin.json().catch(() => null);
  const token = extractSessionToken(signinBody, signin.headers.get('set-cookie'));
  if (!token) throw error(502, 'accounts auth returned no session token');

  // 2. validate the token + resolve the account identity
  const identity = await resolveAccountsBearerIdentity(token);
  if (!identity) throw error(401, 'accounts session could not be verified');

  // 3. authorise: only the configured operator email may assume the operator
  const allowed = getOperatorEmail();
  if (!allowed) throw error(503, 'operator account email not configured');
  if (identity.email.trim().toLowerCase() !== allowed) {
    throw error(403, 'this account is not the configured operator');
  }
  setOperatorEmail({ email: identity.email, updatedBy: 'accounts-login' });

  // 4. mint a local browser session bound to the operator handle
  const handle = getOperatorHandle();
  const roomId = landingRoomId();
  const room = findChatRoomById(roomId);
  if (!room) throw error(503, 'landing room missing — set ANT_BROWSER_LOGIN_ROOM_ID to a valid room id');

  if (!getTerminalIdByHandle(roomId, handle)) {
    const terminal = upsertTerminal({
      pid: 0,
      pid_start: `accounts-login-${Date.now()}`,
      name: `accounts-${roomId}-${handle}`,
      source: 'accounts-login',
      meta: { kind: 'accounts-login', roomId, authorHandle: handle }
    });
    addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  }

  const nowMs = Date.now();
  const result = createBrowserSession({ roomId, authorHandle: handle, nowMs });
  if (!result) throw error(503, 'session could not be minted');

  const cookie = buildSessionCookie(result.browserSessionSecret, result.session.expires_at_ms, nowMs, request);
  return json(
    { ok: true, handle, roomId, email: identity.email },
    { status: 200, headers: { 'set-cookie': cookie } }
  );
};

/** Availability probe used by the login page. */
export const GET: RequestHandler = () => json({ available: true });
