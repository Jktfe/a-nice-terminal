import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  HELPER_LEASE_SCOPE,
  DEFAULT_LEASE_TTL_MS,
  mintLease,
  resolveLeaseBySecret,
  revokeLease,
  getLeaseById,
  listActiveLeasesForHandle,
  isLeaseActive,
  touchLease
} from './helperLeaseStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-helper-lease-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDb;
});

describe('HELPER_LEASE_SCOPE — the fixed contract scope', () => {
  it('grants listen/fire/post and structurally denies author/claim/approve', () => {
    expect(HELPER_LEASE_SCOPE.subscribeFeed).toBe(true);
    expect(HELPER_LEASE_SCOPE.fireRoutes).toBe(true);
    expect(HELPER_LEASE_SCOPE.postStatus).toBe(true);
    expect(HELPER_LEASE_SCOPE.authorMessages).toBe(false);
    expect(HELPER_LEASE_SCOPE.claimHandle).toBe(false);
    expect(HELPER_LEASE_SCOPE.approveAsks).toBe(false);
  });

  it('is frozen — there are no per-lease knobs (anti-spaghetti rule)', () => {
    expect(Object.isFrozen(HELPER_LEASE_SCOPE)).toBe(true);
  });
});

describe('mintLease + resolveLeaseBySecret', () => {
  it('mints an active lease and resolves it by its plaintext secret', () => {
    const { leaseId, secret, lease } = mintLease({
      handle: '@fClaude', owners: ['@JWPK'], pairedHost: 'mac-mini', createdBy: '@JWPK', nowMs: 1000
    });
    expect(leaseId).toBeTruthy();
    expect(secret).toMatch(/^lease_sk_/);
    expect(lease.handle).toBe('@fClaude');
    expect(lease.owners).toEqual(['@JWPK']);
    expect(lease.expires_at_ms).toBe(1000 + DEFAULT_LEASE_TTL_MS);

    const resolved = resolveLeaseBySecret(secret, 2000);
    expect(resolved?.id).toBe(leaseId);
    expect(resolved?.handle).toBe('@fClaude');
    expect(resolved?.owners).toEqual(['@JWPK']);
  });

  it('refuses to mint a lease with no owner (>=1-human-owner invariant)', () => {
    expect(() => mintLease({ handle: '@x', owners: [] })).toThrow(/owner/i);
    expect(() => mintLease({ handle: '@x', owners: ['   '] })).toThrow(/owner/i);
  });

  it('refuses an empty handle', () => {
    expect(() => mintLease({ handle: '  ', owners: ['@JWPK'] })).toThrow(/handle/i);
  });

  it('only stores the hash — a wrong secret never resolves', () => {
    mintLease({ handle: '@fClaude', owners: ['@JWPK'] });
    expect(resolveLeaseBySecret('lease_sk_not-the-secret')).toBeNull();
    expect(resolveLeaseBySecret('')).toBeNull();
  });
});

describe('revoke = instant deafness', () => {
  it('a revoked lease no longer resolves', () => {
    const { leaseId, secret } = mintLease({ handle: '@fClaude', owners: ['@JWPK'], nowMs: 1000 });
    expect(resolveLeaseBySecret(secret, 2000)).not.toBeNull();
    expect(revokeLease(leaseId, 3000)).toBe(true);
    expect(resolveLeaseBySecret(secret, 4000)).toBeNull();
    // double revoke is a no-op
    expect(revokeLease(leaseId, 5000)).toBe(false);
  });
});

describe('TTL expiry', () => {
  it('an expired lease does not resolve; null-TTL never expires', () => {
    const { secret } = mintLease({ handle: '@fClaude', owners: ['@JWPK'], ttlMs: 1000, nowMs: 0 });
    expect(resolveLeaseBySecret(secret, 999)).not.toBeNull();
    expect(resolveLeaseBySecret(secret, 1000)).toBeNull(); // expiry is exclusive (<=)
    expect(resolveLeaseBySecret(secret, 5000)).toBeNull();

    const forever = mintLease({ handle: '@forever', owners: ['@JWPK'], ttlMs: null, nowMs: 0 });
    expect(resolveLeaseBySecret(forever.secret, 10 ** 15)).not.toBeNull();
  });

  it('isLeaseActive reflects revoked + expired', () => {
    const base = { id: 'l', handle: '@x', owners: ['@JWPK'], paired_host: null, created_by: null, created_at_ms: 0, last_seen_at_ms: null };
    expect(isLeaseActive({ ...base, expires_at_ms: 100, revoked_at_ms: null }, 50)).toBe(true);
    expect(isLeaseActive({ ...base, expires_at_ms: 100, revoked_at_ms: null }, 100)).toBe(false);
    expect(isLeaseActive({ ...base, expires_at_ms: null, revoked_at_ms: 5 }, 1)).toBe(false);
  });
});

describe('listActiveLeasesForHandle', () => {
  it('returns only active leases for the handle, newest first', () => {
    const a = mintLease({ handle: '@fClaude', owners: ['@JWPK'], nowMs: 1000 });
    const b = mintLease({ handle: '@fClaude', owners: ['@JWPK'], nowMs: 2000 });
    mintLease({ handle: '@other', owners: ['@JWPK'], nowMs: 1500 });
    revokeLease(a.leaseId, 2500);

    const active = listActiveLeasesForHandle('@fClaude', 3000);
    expect(active.map((l) => l.id)).toEqual([b.leaseId]); // a revoked, newest-first
  });
});

describe('touchLease', () => {
  it('records last-seen without affecting activeness', () => {
    const { leaseId, secret } = mintLease({ handle: '@fClaude', owners: ['@JWPK'], nowMs: 1000 });
    touchLease(leaseId, 2000);
    expect(getLeaseById(leaseId)?.last_seen_at_ms).toBe(2000);
    expect(resolveLeaseBySecret(secret, 3000)).not.toBeNull();
  });
});
