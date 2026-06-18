/**
 * POST /api/auth/demo-login
 *
 * Legacy route name, current behavior: stored-user browser login. The old
 * ANT_DEMO_EMAIL / ANT_DEMO_PASSWORD credential branch is intentionally gone;
 * this route no longer mints identity from launchd demo variables.
 *
 * Cookie: `ant_browser_session=<secret>; Path=/; SameSite=Lax; HttpOnly`
 * + Secure when served over HTTPS (origin header check). 30-day Max-Age
 * (bumped from 24h after JWPK 2026-05-19 "this keeps happening" — the
 * 24h re-auth loop was unworkable for daily-driver use; 30d matches
 * the SURFACE-SIZE-ONLY pattern — long-lived by default, manual logout
 * + the server-side `expires_at_ms` are the actual end-of-life).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import bcrypt from 'bcryptjs';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { addMembership, getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { configuredBrowserLoginRoomId, resolveBrowserLoginRoom } from '$lib/server/browserLoginRoom';
import {
  findStoredUser,
  normalizeAntchatEmail,
  parseAndValidateLicenceKey,
  userShapeForEmail
} from '$lib/server/antchatAuthStore';

type BrowserLoginIdentity = {
  email: string;
  handle: string;
  roomId: string;
};

function buildDemoSessionCookie(secret: string, expiresAtMs: number, nowMs: number, request: Request): string {
  const maxAgeSeconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const parts = [
    `ant_browser_session=${secret}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`
  ];
  const originHeader = request.headers.get('origin');
  let originIsHttps = false;
  if (originHeader) {
    try {
      originIsHttps = new URL(originHeader).protocol === 'https:';
    } catch { /* keep Secure off */ }
  }
  if (originIsHttps) parts.push('Secure');
  return parts.join('; ');
}

async function resolveBrowserLoginIdentity(
  body: Record<string, unknown>
): Promise<BrowserLoginIdentity> {
  const email = body.email;
  const password = body.password;
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw error(400, 'email + password required');
  }

  const normalisedEmail = normalizeAntchatEmail(email);
  const rawLicence = body.license;
  const licence =
    typeof rawLicence === 'string' && rawLicence.trim().length > 0
      ? rawLicence.trim()
      : `NEW-MODEL-ANT-DEV-${normalisedEmail}`;
  const licenceEmail = parseAndValidateLicenceKey(licence);
  if (licenceEmail !== normalisedEmail) {
    throw error(401, 'invalid email or password');
  }

  const stored = findStoredUser(normalisedEmail);
  if (!stored || stored.password_hash === 'PENDING_JWPK_SELF_SET') {
    throw error(401, 'invalid email or password');
  }
  if (stored.must_change_password) {
    throw error(403, 'password rotation required');
  }

  const ok = await bcrypt.compare(password, stored.password_hash);
  if (!ok) {
    throw error(401, 'invalid email or password');
  }

  return {
    email: normalisedEmail,
    handle: userShapeForEmail(normalisedEmail).handle,
    roomId: configuredBrowserLoginRoomId()
  };
}

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');

  const identity = await resolveBrowserLoginIdentity(body as Record<string, unknown>);

  const room = resolveBrowserLoginRoom(identity.roomId);
  if (!room) throw error(503, 'no active room available for browser login');
  const roomId = room.id;

  // Same lazy-create pattern as /api/chat-rooms/:roomId/browser-session
  // so the browser handle gets a synthetic terminal + membership the
  // identity gate accepts downstream.
  if (!getTerminalIdByHandle(roomId, identity.handle)) {
    const syntheticTerminal = upsertTerminal({
      pid: 0,
      pid_start: `browser-login-${Date.now()}`,
      name: `browser-${roomId}-${identity.handle}`,
      source: 'browser-login',
      meta: { kind: 'browser-login', roomId, authorHandle: identity.handle }
    });
    addMembership({ room_id: roomId, handle: identity.handle, terminal_id: syntheticTerminal.id });
  }

  const nowMs = Date.now();
  const result = createBrowserSession({ roomId, authorHandle: identity.handle, nowMs });
  if (!result) throw error(503, 'session could not be minted');

  const cookie = buildDemoSessionCookie(result.browserSessionSecret, result.session.expires_at_ms, nowMs, request);

  return json(
    { ok: true, handle: identity.handle, roomId, email: identity.email },
    { status: 200, headers: { 'set-cookie': cookie } }
  );
};

export const GET: RequestHandler = () => {
  return json({ available: true });
};
