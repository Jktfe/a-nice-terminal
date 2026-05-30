import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bearerTokenFromHeader, revokeToken } from '$lib/server/antchatAuthStore';
import { revokeBrowserSessionBySecret } from '$lib/server/browserSessionStore';

const COOKIE_NAME = 'ant_browser_session';

function readSessionCookie(request: Request): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

const EXPIRED_COOKIE = `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

function performLogout(request: Request): { revokedSession: boolean; revokedToken: boolean } {
  let revokedSession = false;
  let revokedToken = false;

  // Cookie-based browser-session logout (JWPK msg 2026-05-30 — primary
  // path for the web UI; previously only bearer-token revoke existed).
  const cookieSecret = readSessionCookie(request);
  if (cookieSecret) {
    revokedSession = revokeBrowserSessionBySecret(cookieSecret);
  }

  // Bearer-token revoke (antchat clients — existing behaviour preserved).
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (token) {
    revokeToken(token);
    revokedToken = true;
  }

  return { revokedSession, revokedToken };
}

/**
 * POST — programmatic logout. JSON response, sets expired cookie. 401 only
 * if neither cookie nor bearer was supplied.
 */
export const POST: RequestHandler = ({ request }) => {
  const result = performLogout(request);
  if (!result.revokedSession && !result.revokedToken) {
    throw error(401, 'no session cookie or bearer token to revoke');
  }
  return json(
    { ok: true, revoked: result },
    { headers: { 'set-cookie': EXPIRED_COOKIE } }
  );
};

/**
 * GET — browser-friendly logout. Revokes whatever's present, clears the
 * cookie, redirects to /login. Lets the operator just navigate to
 * /api/auth/logout in the URL bar and land at a fresh login screen.
 */
export const GET: RequestHandler = ({ request, cookies }) => {
  performLogout(request);
  cookies.delete(COOKIE_NAME, { path: '/' });
  throw redirect(303, '/login');
};
