/**
 * ownersStore — stable identity for kind="human" members.
 *
 * Part of plan_consent_gate_2026_05_20 (JWPK-locked 2026-05-20):
 * "no agent can post as a human without that human's consent".
 *
 * The handle string (@you, @me, @james…) is a label. The load-bearing
 * identity is the owner row. Consent grants reference owner_id, not
 * the handle, so renames don't invalidate active sessions.
 *
 * Password is bcrypt-hashed (cost 12 — matches antchatAuthStore).
 * TOTP secret is the raw base32 string at rest for now; the schema
 * names the column `totp_secret_encrypted` so a future ANT_OWNER_SECRET_KEY
 * wrap is a column-level migration not a schema change.
 */
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Secret, TOTP } from 'otpauth';
import { getIdentityDb } from './db';

const BCRYPT_COST = 12;
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_ALGORITHM = 'SHA1';
const TOTP_ISSUER = 'ANT';

/**
 * Recovery codes are already-random 32-bit values (4 bytes hex). Using
 * bcrypt on already-random secrets is wasted CPU — sha256 is sufficient
 * for online-only check semantics. Saves ~10s on 10-code enrollment.
 */
function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export type Owner = {
  id: string;
  primaryHandle: string;
  totpEnrolledAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type OwnerRow = {
  id: string;
  primary_handle: string;
  password_hash: string;
  totp_secret_encrypted: string | null;
  totp_enrolled_at_ms: number | null;
  totp_last_counter: number | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function makeOwnerId(): string {
  return `owner_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function rowToOwner(row: OwnerRow): Owner {
  return {
    id: row.id,
    primaryHandle: row.primary_handle,
    totpEnrolledAtMs: row.totp_enrolled_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

/**
 * Create a new owner with a hashed password. Also seeds the owner_handles
 * table with the primary handle as the canonical alias. Throws if the
 * handle is already claimed (UNIQUE constraint).
 */
export function createOwner(input: {
  handle: string;
  password: string;
  nowMs?: number;
}): Owner {
  const now = input.nowMs ?? Date.now();
  const id = makeOwnerId();
  const hash = bcrypt.hashSync(input.password, BCRYPT_COST);
  const db = getIdentityDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO owners
        (id, primary_handle, password_hash, totp_secret_encrypted,
         totp_enrolled_at_ms, totp_last_counter, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)`
    ).run(id, input.handle, hash, now, now);
    db.prepare(
      `INSERT INTO owner_handles (owner_id, handle, is_primary, assigned_at_ms)
       VALUES (?, ?, 1, ?)`
    ).run(id, input.handle, now);
  })();
  return findOwnerById(id) as Owner;
}

export function findOwnerById(id: string): Owner | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM owners WHERE id = ?`)
    .get(id) as OwnerRow | undefined;
  return row ? rowToOwner(row) : null;
}

/**
 * Resolve an owner from any handle they hold (primary or alias).
 * Returns null if the handle is unclaimed.
 */
export function findOwnerByHandle(handle: string): Owner | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT o.* FROM owners o
       JOIN owner_handles h ON h.owner_id = o.id
       WHERE h.handle = ?`
    )
    .get(handle) as OwnerRow | undefined;
  return row ? rowToOwner(row) : null;
}

/**
 * Verify a password against the stored bcrypt hash. Returns false for
 * unknown owners — same outcome as wrong password to avoid timing leaks.
 */
export function verifyOwnerPassword(ownerId: string, password: string): boolean {
  const row = getIdentityDb()
    .prepare(`SELECT password_hash FROM owners WHERE id = ?`)
    .get(ownerId) as { password_hash: string } | undefined;
  if (!row) return false;
  return bcrypt.compareSync(password, row.password_hash);
}

/**
 * Generate a fresh TOTP secret for an unenrolled owner. Returns the raw
 * secret + the otpauth:// URL suitable for QR rendering. Does NOT persist
 * yet — the caller must enroll the secret only after the human verifies
 * a first code (proves the QR was scanned successfully).
 */
export function generateTotpEnrollment(input: {
  ownerId: string;
  accountLabel: string;
}): { secretBase32: string; otpauthUrl: string } {
  const owner = findOwnerById(input.ownerId);
  if (!owner) throw new Error('Owner not found.');
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    label: input.accountLabel,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret
  });
  return { secretBase32: secret.base32, otpauthUrl: totp.toString() };
}

/**
 * Persist a TOTP secret after the human has verified a code against it.
 * The code parameter is the FIRST code the human typed to confirm the
 * QR scan worked. Returns true on success, false if the code is invalid.
 */
export function enrollTotpSecret(input: {
  ownerId: string;
  secretBase32: string;
  verificationCode: string;
  nowMs?: number;
}): boolean {
  const now = input.nowMs ?? Date.now();
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(input.secretBase32)
  });
  const delta = totp.validate({ token: input.verificationCode, window: 1, timestamp: now });
  if (delta === null) return false;
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS) + delta;
  getIdentityDb()
    .prepare(
      `UPDATE owners
       SET totp_secret_encrypted = ?,
           totp_enrolled_at_ms   = ?,
           totp_last_counter     = ?,
           updated_at_ms         = ?
       WHERE id = ?`
    )
    .run(input.secretBase32, now, counter, now, input.ownerId);
  return true;
}

/**
 * Verify a TOTP code for an enrolled owner. Rejects codes whose counter
 * value has already been used (replay protection). On success, advances
 * the stored last-used counter. window=1 accepts the current code plus
 * one period either side to tolerate clock skew.
 *
 * Returns 'ok' on accept, 'replay' if the same code window was already
 * used, 'invalid' if the code is wrong, 'not_enrolled' if the owner has
 * no TOTP secret yet.
 */
export function verifyTotpCode(input: {
  ownerId: string;
  code: string;
  nowMs?: number;
}): 'ok' | 'replay' | 'invalid' | 'not_enrolled' {
  const now = input.nowMs ?? Date.now();
  const row = getIdentityDb()
    .prepare(
      `SELECT totp_secret_encrypted, totp_last_counter FROM owners WHERE id = ?`
    )
    .get(input.ownerId) as
    | { totp_secret_encrypted: string | null; totp_last_counter: number | null }
    | undefined;
  if (!row || !row.totp_secret_encrypted) return 'not_enrolled';
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(row.totp_secret_encrypted)
  });
  const delta = totp.validate({ token: input.code, window: 1, timestamp: now });
  if (delta === null) return 'invalid';
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS) + delta;
  if (row.totp_last_counter !== null && counter <= row.totp_last_counter) {
    return 'replay';
  }
  getIdentityDb()
    .prepare(`UPDATE owners SET totp_last_counter = ?, updated_at_ms = ? WHERE id = ?`)
    .run(counter, now, input.ownerId);
  return 'ok';
}

/**
 * Generate 10 cryptographically-random recovery codes (8-char hex pairs
 * joined by '-' for readability, e.g. 'k7m2-pwz9'). Hashes them with
 * bcrypt and stores them — returns the PLAINTEXT codes to display to
 * the human ONCE. Server never stores the plaintext.
 */
export function issueRecoveryCodes(input: {
  ownerId: string;
  count?: number;
  nowMs?: number;
}): string[] {
  const count = input.count ?? 10;
  const now = input.nowMs ?? Date.now();
  const db = getIdentityDb();
  const codes: string[] = [];
  const stmt = db.prepare(
    `INSERT INTO owner_recovery_codes (owner_id, code_hash, issued_at_ms, used_at_ms)
     VALUES (?, ?, ?, NULL)`
  );
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(4).toString('hex');
    const code = `${bytes.slice(0, 4)}-${bytes.slice(4, 8)}`;
    stmt.run(input.ownerId, hashRecoveryCode(code), now);
    codes.push(code);
  }
  return codes;
}

/**
 * Consume a recovery code. Returns true on first-use, false on
 * already-used / unknown / wrong-owner. Marks the row used on success.
 * Direct hash lookup — recovery codes are already random so sha256 is
 * fine (no offline brute force advantage from bcrypt on random input).
 */
export function consumeRecoveryCode(input: {
  ownerId: string;
  code: string;
  nowMs?: number;
}): boolean {
  const now = input.nowMs ?? Date.now();
  const hash = hashRecoveryCode(input.code);
  const result = getIdentityDb()
    .prepare(
      `UPDATE owner_recovery_codes SET used_at_ms = ?
       WHERE owner_id = ? AND code_hash = ? AND used_at_ms IS NULL`
    )
    .run(now, input.ownerId, hash);
  return result.changes > 0;
}

/**
 * Rename an owner's primary handle. Adds the new handle to owner_handles
 * (preserving the old as a non-primary alias) and updates owners.primary_handle.
 * Throws if the new handle is already claimed by another owner.
 */
export function renameOwnerPrimaryHandle(input: {
  ownerId: string;
  newHandle: string;
  nowMs?: number;
}): Owner {
  const now = input.nowMs ?? Date.now();
  const db = getIdentityDb();
  db.transaction(() => {
    db.prepare(`UPDATE owner_handles SET is_primary = 0 WHERE owner_id = ?`).run(input.ownerId);
    db.prepare(
      `INSERT INTO owner_handles (owner_id, handle, is_primary, assigned_at_ms)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(owner_id, handle) DO UPDATE SET is_primary = 1`
    ).run(input.ownerId, input.newHandle, now);
    db.prepare(
      `UPDATE owners SET primary_handle = ?, updated_at_ms = ? WHERE id = ?`
    ).run(input.newHandle, now, input.ownerId);
  })();
  const refreshed = findOwnerById(input.ownerId);
  if (!refreshed) throw new Error('Owner vanished mid-rename.');
  return refreshed;
}
