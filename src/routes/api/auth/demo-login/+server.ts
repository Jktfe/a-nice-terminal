/**
 * POST /api/auth/demo-login
 *
 * Env-driven demo login for the first-client demo. Validates the posted
 * email + password against ANT_DEMO_EMAIL + ANT_DEMO_PASSWORD launchd env
 * vars, mints a browser-session for the resolved handle in a configured
 * default room, and sets a site-wide cookie so the gate hook in
 * hooks.server.ts lets the operator past /login.
 *
 * Demo credentials are supplied at runtime via ANT_DEMO_EMAIL /
 * ANT_DEMO_PASSWORD (never hard-coded here). Scope: a stopgap
 * before the proper Neon-backed auth flow lands.
 *
 * Reversibility: unset ANT_DEMO_EMAIL or ANT_DEMO_PASSWORD on the launchd
 * plist + kickstart and this endpoint 503s. /login then says auth is
 * unavailable and the operator is back to the prior anonymous-walk-in
 * model (no gate). Zero code change to disable.
 *
 * Security: timingSafeEqual on the password compare (defence against
 * timing attacks even though the threat is low for a demo-only env).
 * No password ever logged. The handle the demo binds to ('@you' by
 * default per JWPK's "reuse @you" scope answer) is configurable via
 * ANT_DEMO_HANDLE.
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
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { addMembership, getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import {
  findStoredUser,
  normalizeAntchatEmail,
  parseAndValidateLicenceKey,
  userShapeForEmail
} from '$lib/server/antchatAuthStore';

const DEFAULT_DEMO_HANDLE = '@you';
const DEFAULT_DEMO_ROOM_ID = 'zj4jlety9q'; // antv4 — JWPK's existing membership

type BrowserLoginIdentity = {
  email: string;
  handle: string;
  roomId: string;
};

function getDemoCreds(): { email: string; password: string; handle: string; roomId: string } | null {
  const email = process.env.ANT_DEMO_EMAIL;
  const password = process.env.ANT_DEMO_PASSWORD;
  if (!email || email.length === 0 || !password || password.length === 0) return null;
  return {
    email,
    password,
    handle: process.env.ANT_DEMO_HANDLE || DEFAULT_DEMO_HANDLE,
    roomId: process.env.ANT_DEMO_ROOM_ID || DEFAULT_DEMO_ROOM_ID
  };
}

function browserLoginRoomId(): string {
  return process.env.ANT_DEMO_ROOM_ID || DEFAULT_DEMO_ROOM_ID;
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

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

  const creds = getDemoCreds();
  if (creds && constantTimeEqual(email, creds.email) && constantTimeEqual(password, creds.password)) {
    return { email: creds.email, handle: creds.handle, roomId: creds.roomId };
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
    roomId: browserLoginRoomId()
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

  const room = findChatRoomById(identity.roomId);
  if (!room) throw error(503, 'demo room missing — set ANT_DEMO_ROOM_ID to a valid room id');

  // Same lazy-create pattern as /api/chat-rooms/:roomId/browser-session
  // so the demo handle gets a synthetic terminal + membership the
  // identity gate accepts downstream.
  if (!getTerminalIdByHandle(identity.roomId, identity.handle)) {
    const syntheticTerminal = upsertTerminal({
      pid: 0,
      pid_start: `demo-login-${Date.now()}`,
      name: `demo-${identity.roomId}-${identity.handle}`,
      source: 'demo-login',
      meta: { kind: 'demo-login', roomId: identity.roomId, authorHandle: identity.handle }
    });
    addMembership({ room_id: identity.roomId, handle: identity.handle, terminal_id: syntheticTerminal.id });
  }

  const nowMs = Date.now();
  const result = createBrowserSession({ roomId: identity.roomId, authorHandle: identity.handle, nowMs });
  if (!result) throw error(503, 'session could not be minted');

  const cookie = buildDemoSessionCookie(result.browserSessionSecret, result.session.expires_at_ms, nowMs, request);

  return json(
    { ok: true, handle: identity.handle, roomId: identity.roomId, email: identity.email },
    { status: 200, headers: { 'set-cookie': cookie } }
  );
};

export const GET: RequestHandler = () => {
  // Surface availability so /login can pre-flight without leaking the
  // configured email. Returns { available: boolean } only.
  return json({ available: getDemoCreds() !== null });
};
