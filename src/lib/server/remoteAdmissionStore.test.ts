// Tests for remoteAdmissionStore (M4 Remote ANT T1).
// Per gate bar: single-use + 20-min acceptance TTL + lifetime preset math.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import {
  createAdmission,
  redeemCode,
  revokeAdmission,
  listActiveForRoom,
  findById,
  mintInviteCode
} from './remoteAdmissionStore';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
});

describe('mintInviteCode', () => {
  it('produces ANT-XXX-YYYY shape', () => {
    const code = mintInviteCode();
    expect(code).toMatch(/^ANT-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it('produces distinct codes across calls', () => {
    const codes = new Set([mintInviteCode(), mintInviteCode(), mintInviteCode(), mintInviteCode()]);
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('createAdmission', () => {
  it('writes a row + returns the plaintext code ONCE', () => {
    const result = createAdmission({ roomId: 'room1', lifetimePreset: '48h', createdByHandle: '@op' });
    expect(result.code.startsWith('ANT-')).toBe(true);
    expect(result.admission.id.startsWith('adm_')).toBe(true);
    expect(result.admission.lifetime_preset).toBe('48h');
    expect(result.admission.created_by_handle).toBe('@op');
    expect(result.admission.accepted_at_ms).toBeNull();
    expect(result.admission.revoked_at_ms).toBeNull();
  });

  it('sets expires_acceptance_at_ms to created_at_ms + 20 min', () => {
    const result = createAdmission({ roomId: 'r2', lifetimePreset: '48h' });
    const delta = result.admission.expires_acceptance_at_ms - result.admission.created_at_ms;
    expect(delta).toBe(20 * 60 * 1000);
  });

  it('expires_at_ms = NULL for indefinite preset', () => {
    const result = createAdmission({ roomId: 'r3', lifetimePreset: 'indefinite' });
    expect(result.admission.expires_at_ms).toBeNull();
  });

  it('expires_at_ms ≈ now + 48h for 48h preset', () => {
    const result = createAdmission({ roomId: 'r4', lifetimePreset: '48h' });
    const delta = (result.admission.expires_at_ms ?? 0) - result.admission.created_at_ms;
    expect(delta).toBe(48 * 60 * 60 * 1000);
  });

  it('expires_at_ms ≈ now + 7d for 7d preset', () => {
    const result = createAdmission({ roomId: 'r5', lifetimePreset: '7d' });
    const delta = (result.admission.expires_at_ms ?? 0) - result.admission.created_at_ms;
    expect(delta).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('redeemCode — single-use + acceptance TTL', () => {
  it('succeeds first time with right code, marks accepted_at_ms + mapping_id', () => {
    const created = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    const result = redeemCode({ admissionId: created.admission.id, code: created.code, mappingId: 'map_aaa' });
    expect(result).not.toBeNull();
    expect(result?.admission.accepted_at_ms).not.toBeNull();
    expect(result?.admission.mapping_id_after_accept).toBe('map_aaa');
  });

  it('SECOND redeem of same admission returns null (single-use)', () => {
    const created = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    redeemCode({ admissionId: created.admission.id, code: created.code, mappingId: 'map_a' });
    const second = redeemCode({ admissionId: created.admission.id, code: created.code, mappingId: 'map_b' });
    expect(second).toBeNull();
  });

  it('wrong code returns null and does NOT mark accepted', () => {
    const created = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    const result = redeemCode({ admissionId: created.admission.id, code: 'ANT-WRONG-CODE', mappingId: 'map_x' });
    expect(result).toBeNull();
    const after = findById(created.admission.id);
    expect(after?.accepted_at_ms).toBeNull();
  });

  it('unknown admission_id returns null', () => {
    const result = redeemCode({ admissionId: 'adm_nope', code: 'ANT-AAA-BBBB', mappingId: 'map_x' });
    expect(result).toBeNull();
  });

  it('revoked admission cannot be redeemed', () => {
    const created = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    revokeAdmission(created.admission.id);
    const result = redeemCode({ admissionId: created.admission.id, code: created.code, mappingId: 'map_x' });
    expect(result).toBeNull();
  });
});

describe('revokeAdmission', () => {
  it('marks revoked_at_ms once; second revoke returns false', () => {
    const created = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    expect(revokeAdmission(created.admission.id)).toBe(true);
    expect(revokeAdmission(created.admission.id)).toBe(false);
  });

  it('returns false for unknown admission', () => {
    expect(revokeAdmission('adm_nope')).toBe(false);
  });
});

describe('listActiveForRoom', () => {
  it('returns active admissions newest-first; excludes revoked', () => {
    const a = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    const b = createAdmission({ roomId: 'r1', lifetimePreset: '7d' });
    const c = createAdmission({ roomId: 'r2', lifetimePreset: 'today' });
    revokeAdmission(b.admission.id);
    const active = listActiveForRoom('r1');
    expect(active.map((row) => row.id)).toEqual([a.admission.id]);
    expect(active.find((row) => row.id === b.admission.id)).toBeUndefined();
    expect(active.find((row) => row.id === c.admission.id)).toBeUndefined();
  });
});
