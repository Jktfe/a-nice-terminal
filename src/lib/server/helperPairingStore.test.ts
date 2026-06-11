import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  mintPairingCode,
  createPairingCode,
  redeemPairingCode,
  findPairingById,
  PAIRING_CODE_TTL_MS
} from './helperPairingStore';
import { resolveLeaseBySecret, listActiveLeasesForHandle } from './helperLeaseStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-helper-pairing-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDb;
});

describe('mintPairingCode', () => {
  it('produces a 6-char code from the unambiguous alphabet (no I/O/0/1)', () => {
    const code = mintPairingCode(Buffer.from([0, 1, 2, 3, 4, 5]));
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
});

describe('createPairingCode', () => {
  it('mints a code with a TTL and refuses empty handle/owners', () => {
    const res = createPairingCode({ handle: '@fClaude', owners: ['@JWPK'], createdBy: '@JWPK', nowMs: 1000 });
    expect(res.code).toHaveLength(6);
    expect(res.expiresAtMs).toBe(1000 + PAIRING_CODE_TTL_MS);
    expect(findPairingById(res.pairingId)?.handle).toBe('@fClaude');

    expect(() => createPairingCode({ handle: '  ', owners: ['@JWPK'] })).toThrow(/handle/i);
    expect(() => createPairingCode({ handle: '@x', owners: [] })).toThrow(/owner/i);
  });
});

describe('redeemPairingCode → mints a lease', () => {
  it('redeems a live code, mints an owned lease, and returns its secret', () => {
    const { code, pairingId } = createPairingCode({ handle: '@fClaude', owners: ['@JWPK'], createdBy: '@JWPK', nowMs: 1000 });
    const redeemed = redeemPairingCode({ code, pairedHost: 'mac-mini', nowMs: 2000 });
    expect(redeemed).not.toBeNull();
    expect(redeemed?.handle).toBe('@fClaude');
    expect(redeemed?.pairingId).toBe(pairingId);

    // the lease is real, active, owned, bound to the handle
    const lease = resolveLeaseBySecret(redeemed!.leaseSecret, 3000);
    expect(lease?.handle).toBe('@fClaude');
    expect(lease?.owners).toEqual(['@JWPK']);
    expect(lease?.paired_host).toBe('mac-mini');
    expect(listActiveLeasesForHandle('@fClaude', 3000)).toHaveLength(1);

    // the code is now consumed, pointing at the minted lease
    expect(findPairingById(pairingId)?.consumed_at_ms).toBe(2000);
  });

  it('is SINGLE-USE — a second redeem of the same code returns null and mints no second lease', () => {
    const { code } = createPairingCode({ handle: '@fClaude', owners: ['@JWPK'], nowMs: 1000 });
    expect(redeemPairingCode({ code, nowMs: 2000 })).not.toBeNull();
    expect(redeemPairingCode({ code, nowMs: 2500 })).toBeNull();
    expect(listActiveLeasesForHandle('@fClaude', 3000)).toHaveLength(1); // not 2
  });

  it('refuses an expired code (no lease minted)', () => {
    const { code } = createPairingCode({ handle: '@fClaude', owners: ['@JWPK'], ttlMs: 1000, nowMs: 0 });
    expect(redeemPairingCode({ code, nowMs: 1000 })).toBeNull(); // expiry exclusive
    expect(redeemPairingCode({ code, nowMs: 5000 })).toBeNull();
    expect(listActiveLeasesForHandle('@fClaude', 6000)).toHaveLength(0);
  });

  it('refuses an unknown / empty code', () => {
    expect(redeemPairingCode({ code: 'ZZZZZZ' })).toBeNull();
    expect(redeemPairingCode({ code: '' })).toBeNull();
  });
});
