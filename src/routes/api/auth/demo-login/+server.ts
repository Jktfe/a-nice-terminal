/**
 * POST /api/auth/demo-login
 *
 * Env-driven demo login for the first-client demo. Validates the posted
 * email + password against ANT_DEMO_EMAIL + ANT_DEMO_PASSWORD launchd env
 * vars, mints a browser-session for the resolved handle in a configured
 * default room, and sets a site-wide cookie so the gate hook in
 * hooks.server.ts lets the operator past /login.
 *
 * JWPK msg_yh5d58msjf locked credentials: james@newmodel.vc / antdev.
 * JWPK msg_3mukvhkqyk + msg_t42mq5ma6u scope: "better auth on neon should
 * be fine for a couple of days while we refine" — this is a stopgap
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
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { addMembership, getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';

const DEFAULT_DEMO_HANDLE = '@you';
const DEFAULT_DEMO_ROOM_ID = 'zj4jlety9q'; // antv4 — JWPK's existing membership

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

export const POST: RequestHandler = async ({ request }) => {
  const creds = getDemoCreds();
  if (!creds) throw error(503, 'demo login not configured');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');
  const email = (body as Record<string, unknown>).email;
  const password = (body as Record<string, unknown>).password;
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw error(400, 'email + password required');
  }

  if (!constantTimeEqual(email, creds.email) || !constantTimeEqual(password, creds.password)) {
    throw error(401, 'invalid email or password');
  }

  const room = findChatRoomById(creds.roomId);
  if (!room) throw error(503, 'demo room missing — set ANT_DEMO_ROOM_ID to a valid room id');

  // Same lazy-create pattern as /api/chat-rooms/:roomId/browser-session
  // so the demo handle gets a synthetic terminal + membership the
  // identity gate accepts downstream.
  if (!getTerminalIdByHandle(creds.roomId, creds.handle)) {
    const syntheticTerminal = upsertTerminal({
      pid: 0,
      pid_start: `demo-login-${Date.now()}`,
      name: `demo-${creds.roomId}-${creds.handle}`,
      source: 'demo-login',
      meta: { kind: 'demo-login', roomId: creds.roomId, authorHandle: creds.handle }
    });
    addMembership({ room_id: creds.roomId, handle: creds.handle, terminal_id: syntheticTerminal.id });
  }

  const nowMs = Date.now();
  const result = createBrowserSession({ roomId: creds.roomId, authorHandle: creds.handle, nowMs });
  if (!result) throw error(503, 'session could not be minted');

  const cookie = buildDemoSessionCookie(result.browserSessionSecret, result.session.expires_at_ms, nowMs, request);

  return json(
    { ok: true, handle: creds.handle, roomId: creds.roomId },
    { status: 200, headers: { 'set-cookie': cookie } }
  );
};

export const GET: RequestHandler = () => {
  // Surface availability so /login can pre-flight without leaking the
  // configured email. Returns { available: boolean } only.
  return json({ available: getDemoCreds() !== null });
};
