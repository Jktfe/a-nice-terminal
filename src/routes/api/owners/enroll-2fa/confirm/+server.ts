/**
 * POST /api/owners/enroll-2fa/confirm — step 2 of TOTP enrollment.
 *
 * Verifies password + the first TOTP code against the candidate secret.
 * Persists the secret and issues 10 one-time recovery codes (the only
 * time the human ever sees them in plaintext).
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  enrollTotpSecret,
  findOwnerByHandle,
  issueRecoveryCodes,
  verifyOwnerPassword
} from '$lib/server/ownersStore';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    handle?: unknown;
    password?: unknown;
    secretBase32?: unknown;
    code?: unknown;
  };
  const handleRaw = typeof body.handle === 'string' ? body.handle.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const secretBase32 = typeof body.secretBase32 === 'string' ? body.secretBase32 : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (handleRaw.length === 0) throw error(400, 'handle required');
  if (password.length === 0) throw error(400, 'password required');
  if (secretBase32.length === 0) throw error(400, 'secretBase32 required');
  if (!/^\d{6}$/.test(code)) throw error(400, 'code must be 6 digits');
  const handle = handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`;
  const owner = findOwnerByHandle(handle);
  if (!owner) throw error(404, 'owner not found');
  if (!verifyOwnerPassword(owner.id, password)) throw error(401, 'password incorrect');
  const enrolled = enrollTotpSecret({
    ownerId: owner.id,
    secretBase32,
    verificationCode: code
  });
  if (!enrolled) throw error(400, 'code did not verify against the secret');
  const recoveryCodes = issueRecoveryCodes({ ownerId: owner.id });
  return json({ ownerId: owner.id, enrolled: true, recoveryCodes });
};
