import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assignOrgAdmin,
  createOrg,
  getOrg,
  getOrgByNamespacePrefix,
  isOrgAdmin,
  listOrgAdmins,
  listOrgs,
  resetOrgsStoreForTests,
  revokeOrgAdmin,
  setOrgTier
} from './orgsStore';

beforeEach(() => {
  resetOrgsStoreForTests();
});

afterEach(() => {
  resetOrgsStoreForTests();
});

describe('createOrg', () => {
  it('creates an org with default tier oss + null archived_at_ms', () => {
    const org = createOrg({
      id: 'acme',
      displayName: 'Acme Holdings',
      namespacePrefix: 'org.acme',
      createdBy: '@james'
    });
    expect(org.id).toBe('acme');
    expect(org.displayName).toBe('Acme Holdings');
    expect(org.namespacePrefix).toBe('org.acme');
    expect(org.tier).toBe('oss');
    expect(org.archivedAtMs).toBeNull();
    expect(org.createdAtMs).toBeGreaterThan(0);
  });

  it('honours explicit tier (premium / enterprise)', () => {
    const org = createOrg({
      id: 'nmvc',
      displayName: 'New Model VC',
      namespacePrefix: 'org.nmvc',
      tier: 'premium',
      createdBy: '@james'
    });
    expect(org.tier).toBe('premium');
  });

  it('rejects duplicate id with readable error', () => {
    createOrg({
      id: 'acme',
      displayName: 'Acme',
      namespacePrefix: 'org.acme',
      createdBy: '@james'
    });
    expect(() =>
      createOrg({
        id: 'acme',
        displayName: 'Acme Two',
        namespacePrefix: 'org.acme-2',
        createdBy: '@james'
      })
    ).toThrow(/already exists/);
  });

  it('rejects duplicate namespace_prefix with namespace-specific error', () => {
    createOrg({
      id: 'acme',
      displayName: 'Acme',
      namespacePrefix: 'org.acme',
      createdBy: '@james'
    });
    expect(() =>
      createOrg({
        id: 'acme-2',
        displayName: 'Acme Two',
        namespacePrefix: 'org.acme',
        createdBy: '@james'
      })
    ).toThrow(/already registered/);
  });
});

describe('getOrg / getOrgByNamespacePrefix / listOrgs', () => {
  it('returns null when org not found', () => {
    expect(getOrg('missing')).toBeNull();
    expect(getOrgByNamespacePrefix('org.missing')).toBeNull();
  });

  it('round-trips id + namespace lookups', () => {
    const created = createOrg({
      id: 'acme',
      displayName: 'Acme',
      namespacePrefix: 'org.acme',
      createdBy: '@james'
    });
    expect(getOrg('acme')?.id).toBe('acme');
    expect(getOrgByNamespacePrefix('org.acme')?.id).toBe('acme');
    expect(getOrg('acme')?.createdAtMs).toBe(created.createdAtMs);
  });

  it('listOrgs returns newest-first', () => {
    createOrg({ id: 'a', displayName: 'A', namespacePrefix: 'org.a', createdBy: '@x' });
    // ensure distinct created_at_ms for ordering — tick the clock past 1ms
    const before = Date.now();
    while (Date.now() === before) { /* spin briefly */ }
    createOrg({ id: 'b', displayName: 'B', namespacePrefix: 'org.b', createdBy: '@x' });
    const orgs = listOrgs();
    expect(orgs.map((o) => o.id)).toEqual(['b', 'a']);
  });
});

describe('setOrgTier', () => {
  it('flips oss → premium → enterprise', () => {
    createOrg({ id: 'acme', displayName: 'A', namespacePrefix: 'org.acme', createdBy: '@x' });
    expect(setOrgTier('acme', 'premium').tier).toBe('premium');
    expect(setOrgTier('acme', 'enterprise').tier).toBe('enterprise');
    expect(getOrg('acme')?.tier).toBe('enterprise');
  });

  it('throws when org not found', () => {
    expect(() => setOrgTier('missing', 'premium')).toThrow(/not found/);
  });
});

describe('assignOrgAdmin', () => {
  it('assigns admin + idempotent for active rows', () => {
    createOrg({ id: 'acme', displayName: 'A', namespacePrefix: 'org.acme', createdBy: '@james' });
    const a = assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@system' });
    const b = assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@system' });
    expect(a.id).toBe(b.id);
    expect(listOrgAdmins('acme')).toHaveLength(1);
  });

  it('rejects assignment when org does not exist', () => {
    expect(() =>
      assignOrgAdmin({ orgId: 'missing', handle: '@james', assignedBy: '@system' })
    ).toThrow(/not found/);
  });

  it('supports multiple admins on the same org', () => {
    createOrg({ id: 'acme', displayName: 'A', namespacePrefix: 'org.acme', createdBy: '@james' });
    assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@system' });
    assignOrgAdmin({ orgId: 'acme', handle: '@speedycodex', assignedBy: '@james' });
    const admins = listOrgAdmins('acme');
    expect(admins.map((a) => a.handle).sort()).toEqual(['@james', '@speedycodex']);
  });
});

describe('revokeOrgAdmin', () => {
  it('soft-revokes an active admin row', () => {
    createOrg({ id: 'acme', displayName: 'A', namespacePrefix: 'org.acme', createdBy: '@james' });
    assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@system' });
    expect(revokeOrgAdmin({ orgId: 'acme', handle: '@james', revokedBy: '@speedycodex' })).toBe(true);
    expect(listOrgAdmins('acme')).toEqual([]);
    expect(isOrgAdmin('acme', '@james')).toBe(false);
  });

  it('returns false when no active row exists to revoke', () => {
    createOrg({ id: 'acme', displayName: 'A', namespacePrefix: 'org.acme', createdBy: '@james' });
    expect(revokeOrgAdmin({ orgId: 'acme', handle: '@nobody', revokedBy: '@system' })).toBe(false);
  });

  it('allows re-grant after revocation (partial UNIQUE permits it)', () => {
    createOrg({ id: 'acme', displayName: 'A', namespacePrefix: 'org.acme', createdBy: '@james' });
    const first = assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@system' });
    revokeOrgAdmin({ orgId: 'acme', handle: '@james', revokedBy: '@speedycodex' });
    const second = assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@system' });
    expect(second.id).not.toBe(first.id);
    expect(listOrgAdmins('acme')).toHaveLength(1);
    expect(isOrgAdmin('acme', '@james')).toBe(true);
  });
});

describe('isOrgAdmin', () => {
  it('returns true only for active admin rows', () => {
    createOrg({ id: 'acme', displayName: 'A', namespacePrefix: 'org.acme', createdBy: '@james' });
    expect(isOrgAdmin('acme', '@james')).toBe(false);
    assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@system' });
    expect(isOrgAdmin('acme', '@james')).toBe(true);
    revokeOrgAdmin({ orgId: 'acme', handle: '@james', revokedBy: '@system' });
    expect(isOrgAdmin('acme', '@james')).toBe(false);
  });
});

describe('FK cascade behaviour', () => {
  it('listOrgAdmins returns empty for unknown org (no cross-org leakage)', () => {
    createOrg({ id: 'acme', displayName: 'A', namespacePrefix: 'org.acme', createdBy: '@x' });
    createOrg({ id: 'nmvc', displayName: 'N', namespacePrefix: 'org.nmvc', createdBy: '@x' });
    assignOrgAdmin({ orgId: 'acme', handle: '@james', assignedBy: '@x' });
    expect(listOrgAdmins('nmvc')).toEqual([]);
  });
});
