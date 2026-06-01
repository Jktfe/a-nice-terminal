// Tests for remoteMappingStore (M4 Remote ANT T1).
// Per gate bars: bridge tokens hashed, only returned on createMapping;
// synthetic terminal + room_membership written in same tx with
// agent_kind=remote, pane_status=verified; revoke preserves audit and
// blocks future bearer resolution; touchLastSeen no-ops on revoked.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import {
  createMapping,
  resolveByBearer,
  revokeMapping,
  touchLastSeen,
  listActiveForRoom,
  findById
} from './remoteMappingStore';
import { createAdmission } from './remoteAdmissionStore';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
});

let labelCounter = 0;
function makeMapping(overrides: Partial<{ roomId: string; label: string }> = {}) {
  const adm = createAdmission({ roomId: overrides.roomId ?? 'room1', lifetimePreset: '48h' });
  labelCounter += 1;
  return createMapping({
    roomId: overrides.roomId ?? 'room1',
    remoteInstanceLabel: overrides.label ?? `remoteX-${labelCounter}`,
    admissionId: adm.admission.id,
    lifetimePreset: '48h',
    expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
  });
}

describe('createMapping', () => {
  it('returns plaintext bridge_token starting with rbt_ ONCE', () => {
    const result = makeMapping();
    expect(result.bridgeToken.startsWith('rbt_')).toBe(true);
    expect(result.mapping.id.startsWith('map_')).toBe(true);
  });

  it('writes synthetic terminal row with agent_kind=remote + pane_status=verified + name=@label per contract', () => {
    const result = makeMapping({ label: 'inst-name-test' });
    const db = getIdentityDb();
    const row = db.prepare(`SELECT agent_kind, pane_status, name FROM terminals WHERE id = ?`)
      .get(`remote-${result.mapping.id}`) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.agent_kind).toBe('remote');
    expect(row?.pane_status).toBe('verified');
    expect(row?.name).toBe('@inst-name-test');
  });

  it('writes synthetic room_membership row with @label handle', () => {
    const result = makeMapping({ label: 'remoteY' });
    const db = getIdentityDb();
    const row = db.prepare(`SELECT handle, terminal_id FROM room_memberships WHERE id = ?`)
      .get(`mem_${result.mapping.id}`) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.handle).toBe('@remoteY');
    expect(row?.terminal_id).toBe(`remote-${result.mapping.id}`);
  });

  it('default direction is "both"', () => {
    const result = makeMapping();
    expect(result.mapping.direction).toBe('both');
  });
});

describe('resolveByBearer', () => {
  it('returns mapping_id + room_id + label for valid token', () => {
    const result = makeMapping({ roomId: 'r2', label: 'inst2' });
    const resolved = resolveByBearer(result.bridgeToken);
    expect(resolved).not.toBeNull();
    expect(resolved?.mapping_id).toBe(result.mapping.id);
    expect(resolved?.room_id).toBe('r2');
    expect(resolved?.remote_instance_label).toBe('inst2');
  });

  it('returns null for unknown bearer', () => {
    expect(resolveByBearer('rbt_unknown')).toBeNull();
  });

  it('returns null for revoked mapping (B3 — revoke prevents future bearer resolution)', () => {
    const result = makeMapping();
    expect(resolveByBearer(result.bridgeToken)).not.toBeNull();
    revokeMapping(result.mapping.id);
    expect(resolveByBearer(result.bridgeToken)).toBeNull();
  });

  it('returns null for expired mapping', () => {
    const adm = createAdmission({ roomId: 'r3', lifetimePreset: '48h' });
    const expired = createMapping({
      roomId: 'r3', remoteInstanceLabel: 'expired', admissionId: adm.admission.id,
      lifetimePreset: '48h', expiresAtMs: Date.now() - 1000
    });
    expect(resolveByBearer(expired.bridgeToken)).toBeNull();
  });

  it('does NOT leak token bytes via mapping row reads (hash-only stored)', () => {
    const result = makeMapping();
    const db = getIdentityDb();
    const row = db.prepare(`SELECT bridge_token_hash FROM chat_remote_mappings WHERE id = ?`)
      .get(result.mapping.id) as Record<string, unknown> | undefined;
    expect(row?.bridge_token_hash).not.toBe(result.bridgeToken);
    expect((row?.bridge_token_hash as string).length).toBeGreaterThan(0);
  });
});

describe('revokeMapping', () => {
  it('marks mapping revoked_at_ms once; second revoke returns false', () => {
    const result = makeMapping();
    expect(revokeMapping(result.mapping.id)).toBe(true);
    expect(revokeMapping(result.mapping.id)).toBe(false);
  });

  it('marks synthetic membership inactive (no-delete) per contract Q4', () => {
    const result = makeMapping();
    revokeMapping(result.mapping.id);
    const db = getIdentityDb();
    const mem = db.prepare(`SELECT id, revoked_at_ms FROM room_memberships WHERE id = ?`)
      .get(`mem_${result.mapping.id}`) as Record<string, unknown> | undefined;
    expect(mem).toBeDefined();
    expect(mem?.revoked_at_ms).not.toBeNull();
  });

  it('preserves synthetic terminal row for audit (no delete)', () => {
    const result = makeMapping();
    revokeMapping(result.mapping.id);
    const db = getIdentityDb();
    const term = db.prepare(`SELECT id FROM terminals WHERE id = ?`)
      .get(`remote-${result.mapping.id}`);
    expect(term).toBeDefined();
  });
});

describe('touchLastSeen', () => {
  it('bumps last_seen_at_ms on active mapping', () => {
    const result = makeMapping();
    expect(findById(result.mapping.id)?.last_seen_at_ms).toBeNull();
    touchLastSeen(result.mapping.id);
    const after = findById(result.mapping.id);
    expect(after?.last_seen_at_ms).not.toBeNull();
  });

  it('does NOT bump revoked mapping (per polish A — auth-resolves-first)', () => {
    const result = makeMapping();
    revokeMapping(result.mapping.id);
    touchLastSeen(result.mapping.id);
    const after = findById(result.mapping.id);
    expect(after?.last_seen_at_ms).toBeNull();
  });
});

describe('listActiveForRoom', () => {
  it('returns active mappings newest-first; excludes revoked', () => {
    const a = makeMapping({ roomId: 'r1' });
    const b = makeMapping({ roomId: 'r1', label: 'b' });
    revokeMapping(a.mapping.id);
    const active = listActiveForRoom('r1');
    expect(active.map((m) => m.id)).toEqual([b.mapping.id]);
  });
});
