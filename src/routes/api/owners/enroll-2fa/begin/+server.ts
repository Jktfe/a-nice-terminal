/**
 * POST /api/owners/enroll-2fa/begin — step 1 of TOTP enrollment.
 *
 * Verifies the owner's password, generates a fresh TOTP secret, and
 * returns the otpauth:// URL for the CLI to render as a QR. The secret
 * is NOT persisted yet — the caller must complete /confirm with a
 * verification code to prove the QR was scanned successfully.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  findOwnerByHandle,
  generateTotpEnrollment,
  verifyOwnerPassword
} from '$lib/server/ownersStore';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    handle?: unknown;
    password?: unknown;
  };
  const handleRaw = typeof body.handle === 'string' ? body.handle.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (handleRaw.length === 0) throw error(400, 'handle required');
  if (password.length === 0) throw error(400, 'password required');
  const handle = handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`;
  const owner = findOwnerByHandle(handle);
  if (!owner) throw error(404, 'owner not found');
  if (!verifyOwnerPassword(owner.id, password)) throw error(401, 'password incorrect');
  if (owner.totpEnrolledAtMs !== null) {
    throw error(409, 'TOTP already enrolled — revoke first to re-enroll');
  }
  const enroll = generateTotpEnrollment({
    ownerId: owner.id,
    accountLabel: owner.primaryHandle
  });
  return json({ ownerId: owner.id, ...enroll });
};
