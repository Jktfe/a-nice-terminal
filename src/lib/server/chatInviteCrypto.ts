/**
 * Chat invite crypto helpers — extracted from chatInviteStore for line
 * discipline. Pure functions; no I/O, no state.
 *
 * hashPassword + verifyPassword: scrypt (N=16384, r=8, p=1, keylen=32)
 *   over a 16-byte random salt, encoded as
 *   "scrypt$N$r$p$salt$derived" with base64url segments.
 *
 * hashToken + mintTokenSecret: sha256(plaintext) hex; random 32-byte
 *   hex bearer. Plaintext bearer NEVER stored — only hash.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
const TOKEN_SECRET_BYTES = 32;
const MIN_PASSWORD_LENGTH = 4;

export function hashPassword(plain: string): string {
  if (typeof plain !== 'string' || plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = scryptSync(plain, salt, SCRYPT_KEY_LENGTH_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let derived: Buffer;
  try {
    derived = scryptSync(plain, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export function mintTokenSecret(): string {
  return randomBytes(TOKEN_SECRET_BYTES).toString('hex');
}
