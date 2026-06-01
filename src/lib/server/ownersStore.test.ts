import { beforeEach, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  consumeRecoveryCode,
  createOwner,
  enrollTotpSecret,
  findOwnerByHandle,
  findOwnerById,
  generateTotpEnrollment,
  issueRecoveryCodes,
  renameOwnerPrimaryHandle,
  verifyOwnerPassword,
  verifyTotpCode
} from './ownersStore';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

function codeFor(secretBase32: string, atMs: number): string {
  const totp = new TOTP({
    issuer: 'ANT',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32)
  });
  return totp.generate({ timestamp: atMs });
}

describe('ownersStore', () => {
  it('creates an owner with a hashed password and seeds the primary handle', () => {
    const owner = createOwner({ handle: '@you', password: 'hunter2' });
    expect(owner.id).toMatch(/^owner_/);
    expect(owner.primaryHandle).toBe('@you');
    expect(owner.totpEnrolledAtMs).toBeNull();
    expect(verifyOwnerPassword(owner.id, 'hunter2')).toBe(true);
    expect(verifyOwnerPassword(owner.id, 'wrong')).toBe(false);
  });

  it('resolves an owner from its primary handle', () => {
    const created = createOwner({ handle: '@me', password: 'pw' });
    const found = findOwnerByHandle('@me');
    expect(found?.id).toBe(created.id);
    expect(findOwnerByHandle('@nobody')).toBeNull();
  });

  it('generates a TOTP enrollment URL without persisting it', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const enrol = generateTotpEnrollment({ ownerId: owner.id, accountLabel: 'james@ant' });
    expect(enrol.secretBase32).toMatch(/^[A-Z2-7]+$/);
    expect(enrol.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(findOwnerById(owner.id)?.totpEnrolledAtMs).toBeNull();
  });

  it('enrolls a TOTP secret only after a valid first code', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const enrol = generateTotpEnrollment({ ownerId: owner.id, accountLabel: 'a' });
    const now = 1_700_000_000_000;
    const goodCode = codeFor(enrol.secretBase32, now);
    expect(enrollTotpSecret({ ownerId: owner.id, secretBase32: enrol.secretBase32, verificationCode: '000000', nowMs: now })).toBe(false);
    expect(findOwnerById(owner.id)?.totpEnrolledAtMs).toBeNull();
    expect(enrollTotpSecret({ ownerId: owner.id, secretBase32: enrol.secretBase32, verificationCode: goodCode, nowMs: now })).toBe(true);
    expect(findOwnerById(owner.id)?.totpEnrolledAtMs).toBe(now);
  });

  it('verifies TOTP codes, rejects replay, and rejects unenrolled owners', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const enrol = generateTotpEnrollment({ ownerId: owner.id, accountLabel: 'a' });
    const now = 1_700_000_000_000;
    expect(verifyTotpCode({ ownerId: owner.id, code: '123456', nowMs: now })).toBe('not_enrolled');
    enrollTotpSecret({ ownerId: owner.id, secretBase32: enrol.secretBase32, verificationCode: codeFor(enrol.secretBase32, now), nowMs: now });
    const future = now + 60_000;
    const valid = codeFor(enrol.secretBase32, future);
    expect(verifyTotpCode({ ownerId: owner.id, code: valid, nowMs: future })).toBe('ok');
    expect(verifyTotpCode({ ownerId: owner.id, code: valid, nowMs: future })).toBe('replay');
    expect(verifyTotpCode({ ownerId: owner.id, code: '000000', nowMs: future + 30_000 })).toBe('invalid');
  });

  it('issues 10 recovery codes once and lets each be consumed exactly once', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    const codes = issueRecoveryCodes({ ownerId: owner.id });
    expect(codes.length).toBe(10);
    expect(new Set(codes).size).toBe(10);
    expect(consumeRecoveryCode({ ownerId: owner.id, code: codes[0] })).toBe(true);
    expect(consumeRecoveryCode({ ownerId: owner.id, code: codes[0] })).toBe(false);
    expect(consumeRecoveryCode({ ownerId: owner.id, code: 'not-a-code' })).toBe(false);
    expect(consumeRecoveryCode({ ownerId: owner.id, code: codes[1] })).toBe(true);
  });

  it('renames the primary handle without invalidating ownership lookups for the old alias', () => {
    const owner = createOwner({ handle: '@you', password: 'pw' });
    renameOwnerPrimaryHandle({ ownerId: owner.id, newHandle: '@me' });
    expect(findOwnerById(owner.id)?.primaryHandle).toBe('@me');
    expect(findOwnerByHandle('@me')?.id).toBe(owner.id);
    expect(findOwnerByHandle('@you')?.id).toBe(owner.id);
  });


  it('schema includes external_account_id column (nullable, unique when set)', () => {
    const owner = createOwner({ handle: '@acct', password: 'pw' });
    const db = getIdentityDb();
    expect(owner.externalAccountId).toBeNull();

    // Column accepts NULL
    const rowNull = db.prepare('SELECT external_account_id FROM owners WHERE id = ?').get(owner.id) as { external_account_id: string | null };
    expect(rowNull.external_account_id).toBeNull();

    // Column accepts a value
    db.prepare('UPDATE owners SET external_account_id = ? WHERE id = ?').run('acct_123', owner.id);
    const rowSet = db.prepare('SELECT external_account_id FROM owners WHERE id = ?').get(owner.id) as { external_account_id: string | null };
    expect(rowSet.external_account_id).toBe('acct_123');

    // Unique index prevents duplicate external_account_id
    const owner2 = createOwner({ handle: '@acct2', password: 'pw2' });
    expect(() => {
      db.prepare('UPDATE owners SET external_account_id = ? WHERE id = ?').run('acct_123', owner2.id);
    }).toThrow(/UNIQUE constraint failed/);

    // Same value on the same row is fine (idempotent)
    db.prepare('UPDATE owners SET external_account_id = ? WHERE id = ?').run('acct_123', owner.id);

    // NULL is not constrained by partial unique index
    db.prepare('UPDATE owners SET external_account_id = ? WHERE id = ?').run(null, owner2.id);
    const rowNull2 = db.prepare('SELECT external_account_id FROM owners WHERE id = ?').get(owner2.id) as { external_account_id: string | null };
    expect(rowNull2.external_account_id).toBeNull();
  });
});
