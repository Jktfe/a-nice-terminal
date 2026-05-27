/**
 * POST /api/auth/login
 *
 * Mac antchat team login. Validates email + password + licence in one shot
 * against ~/.ant/dev-users.json + ~/.ant/dev-licences.json.
 *
 * Request body:  { email, password, license }
 * Success (200): { token, user, expiresAt }
 * Must rotate (200): { requiresPasswordRotation: true, tempToken }
 * Failure: 400 (missing field) / 401 (bad creds) / 403 (licence not allowlisted)
 *
 * Spec: ObsidiANT/contracts/antchat-api-2026-05-19.md §1.
 * Authority: JWPK msg_m23v9tltxi (demo-pressure pickup by @antchatdev).
 *
 * Implementation: first-cut by @antchatdev to unblock today's demo.
 * @evolveantcodex's F11 takeover should swap the file-backed store for
 * SQLite tokens table + admin endpoints.
 */

import { error, json } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import type { RequestHandler } from './$types';
import {
  findStoredUser,
  parseAndValidateLicenceKey,
  issueToken,
  userShapeForEmail
} from '$lib/server/antchatAuthStore';
import { handlesForEmail } from '$lib/server/chatRoomReadGate';

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');

  const raw = body as Record<string, unknown>;
  const email = raw.email;
  const password = raw.password;
  const license = raw.license;
  if (typeof email !== 'string' || email.trim().length === 0) {
    throw error(400, 'email required');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw error(400, 'password required');
  }
  if (typeof license !== 'string' || license.trim().length === 0) {
    throw error(400, 'license required');
  }

  const licenceEmail = parseAndValidateLicenceKey(license);
  if (!licenceEmail) {
    throw error(403, 'licence not allowlisted');
  }
  if (licenceEmail !== email.trim().toLowerCase()) {
    throw error(403, 'licence does not match email');
  }

  const stored = findStoredUser(email);
  if (!stored) {
    // Don't leak existence — same response shape as a wrong password.
    throw error(401, 'invalid email or password');
  }

  // Special-case the PENDING marker until JWPK seeds his own.
  if (stored.password_hash === 'PENDING_JWPK_SELF_SET') {
    throw error(503, 'password not set for this account yet');
  }

  const ok = await bcrypt.compare(password, stored.password_hash);
  if (!ok) {
    throw error(401, 'invalid email or password');
  }

  if (stored.must_change_password) {
    // Issue a short-lived temp token clients use on POST /api/auth/rotate-password.
    // For demo simplicity we reuse the same token store; the temp token IS the session.
    const { token } = issueToken(email);
    return json({
      requiresPasswordRotation: true,
      tempToken: token
    });
  }

  const { token, expiresAtMs } = issueToken(email);
  // handleFamily mirrors the server's auth gate alias set — see
  // /api/auth/me + eiw05zdurz 2026-05-27 msg_s21fibyq79.
  return json({
    token,
    user: {
      ...userShapeForEmail(email),
      handleFamily: handlesForEmail(email)
    },
    expiresAt: expiresAtMs
  });
};
