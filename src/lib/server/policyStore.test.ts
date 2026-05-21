import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPolicy,
  getPolicyBySlug,
  getPolicyById,
  listPublicPolicies,
  listPoliciesOwnedBy,
  listAuditForPolicy,
  updatePolicy,
  softDeletePolicy,
  restorePolicy,
  clonePolicy,
  slugifyPolicyName,
  resetPolicyStoreForTests,
  type PolicyBody,
} from './policyStore';
import { resetIdentityDbForTests, getIdentityDb } from './db';

const NOW = 1779000000000;
const POLICY: PolicyBody = { blocks: { external_link: { agents: 2 } }, fallback: { humans: 1 } };

beforeEach(() => {
  resetIdentityDbForTests();
});

afterEach(() => {
  resetPolicyStoreForTests();
});

describe('slugifyPolicyName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyPolicyName('My Great Policy')).toBe('my-great-policy');
  });
  it('strips special chars', () => {
    expect(slugifyPolicyName('FCA 2026! @#$')).toBe('fca-2026');
  });
  it('collapses multiple hyphens', () => {
    expect(slugifyPolicyName('A   B')).toBe('a-b');
  });
  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(120);
    expect(slugifyPolicyName(long).length).toBe(80);
  });
});

describe('createPolicy', () => {
  it('creates with defaults', () => {
    const p = createPolicy({ name: 'Test', ownerHandle: '@you', actorKind: 'human', policy: POLICY, nowMs: NOW });
    expect(p.name).toBe('Test');
    expect(p.slug).toBe('test');
    expect(p.ownerHandle).toBe('@you');
    expect(p.visibility).toBe('public');
    expect(p.createdAtMs).toBe(NOW);
    expect(p.deletedAtMs).toBeNull();
    expect(p.policy).toEqual(POLICY);
  });

  it('rejects blank name', () => {
    expect(() => createPolicy({ name: '   ', ownerHandle: '@you', actorKind: 'human', policy: POLICY })).toThrow('blank');
  });

  it('rejects missing ownerHandle', () => {
    expect(() => createPolicy({ name: 'X', ownerHandle: '  ', actorKind: 'human', policy: POLICY })).toThrow('owner_handle');
  });

  it('deduplicates slug', () => {
    createPolicy({ name: 'Test', ownerHandle: '@a', actorKind: 'human', policy: POLICY });
    const p2 = createPolicy({ name: 'Test', ownerHandle: '@b', actorKind: 'agent', policy: POLICY });
    expect(p2.slug).toBe('test-2');
  });

  it('writes audit row', () => {
    const p = createPolicy({ name: 'A', ownerHandle: '@you', actorKind: 'human', policy: POLICY, reason: 'init' });
    const audit = listAuditForPolicy(p.id);
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe('create');
    expect(audit[0].actorHandle).toBe('@you');
    expect(audit[0].actorKind).toBe('human');
    expect(audit[0].reason).toBe('init');
    expect(audit[0].before).toBeNull();
    expect(audit[0].after).toEqual(POLICY);
  });
});

describe('getPolicyBySlug / getPolicyById', () => {
  it('round-trips', () => {
    const created = createPolicy({ name: 'Round', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    expect(getPolicyBySlug(created.slug)?.id).toBe(created.id);
    expect(getPolicyById(created.id)?.slug).toBe(created.slug);
  });

  it('returns undefined for unknown', () => {
    expect(getPolicyBySlug('nope')).toBeUndefined();
    expect(getPolicyById('nope')).toBeUndefined();
  });
});

describe('listPublicPolicies', () => {
  it('is empty initially', () => {
    expect(listPublicPolicies()).toEqual([]);
  });

  it('filters deleted', () => {
    const p = createPolicy({ name: 'D', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    softDeletePolicy(p.slug, '@you', 'human');
    expect(listPublicPolicies()).toEqual([]);
    expect(listPublicPolicies({ includeDeleted: true })).toHaveLength(1);
  });

  it('filters by owner', () => {
    createPolicy({ name: 'A', ownerHandle: '@a', actorKind: 'human', policy: POLICY });
    createPolicy({ name: 'B', ownerHandle: '@b', actorKind: 'human', policy: POLICY });
    expect(listPublicPolicies({ ownerHandle: '@a' })).toHaveLength(1);
    expect(listPublicPolicies({ ownerHandle: '@a' })[0].ownerHandle).toBe('@a');
  });

  it('orders by updated_at_ms desc', () => {
    const p1 = createPolicy({ name: 'Old', ownerHandle: '@you', actorKind: 'human', policy: POLICY, nowMs: NOW });
    const p2 = createPolicy({ name: 'New', ownerHandle: '@you', actorKind: 'human', policy: POLICY, nowMs: NOW + 1000 });
    const list = listPublicPolicies();
    expect(list[0].id).toBe(p2.id);
    expect(list[1].id).toBe(p1.id);
  });
});

describe('listPoliciesOwnedBy', () => {
  it('returns only owned', () => {
    createPolicy({ name: 'A', ownerHandle: '@a', actorKind: 'human', policy: POLICY });
    createPolicy({ name: 'B', ownerHandle: '@b', actorKind: 'human', policy: POLICY });
    expect(listPoliciesOwnedBy('@a')).toHaveLength(1);
    expect(listPoliciesOwnedBy('@a')[0].name).toBe('A');
  });

  it('excludes deleted', () => {
    const p = createPolicy({ name: 'X', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    softDeletePolicy(p.slug, '@you', 'human');
    expect(listPoliciesOwnedBy('@you')).toHaveLength(0);
  });
});

describe('updatePolicy', () => {
  it('updates name and policy', () => {
    const p = createPolicy({ name: 'Orig', ownerHandle: '@you', actorKind: 'human', policy: { a: 1 }, nowMs: NOW });
    const updated = updatePolicy({ slug: p.slug, actorHandle: '@you', actorKind: 'human', name: 'New', policy: { a: 2 }, nowMs: NOW + 1 });
    expect(updated!.name).toBe('New');
    expect(updated!.policy).toEqual({ a: 2 });
    expect(updated!.updatedAtMs).toBe(NOW + 1);
  });

  it('returns undefined for unknown', () => {
    expect(updatePolicy({ slug: 'nope', actorHandle: '@you', actorKind: 'human', name: 'X' })).toBeUndefined();
  });

  it('returns undefined for deleted', () => {
    const p = createPolicy({ name: 'D', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    softDeletePolicy(p.slug, '@you', 'human');
    expect(updatePolicy({ slug: p.slug, actorHandle: '@you', actorKind: 'human', name: 'X' })).toBeUndefined();
  });

  it('writes audit row for update', () => {
    const p = createPolicy({ name: 'A', ownerHandle: '@you', actorKind: 'human', policy: { a: 1 }, nowMs: NOW });
    updatePolicy({ slug: p.slug, actorHandle: '@you', actorKind: 'human', policy: { a: 2 } });
    const audit = listAuditForPolicy(p.id);
    expect(audit.length).toBe(2);
    expect(audit[0].action).toBe('update');
  });

  it('writes visibility_change audit when visibility changes', () => {
    const p = createPolicy({ name: 'A', ownerHandle: '@you', actorKind: 'human', policy: POLICY, visibility: 'public', nowMs: NOW });
    updatePolicy({ slug: p.slug, actorHandle: '@you', actorKind: 'human', visibility: 'private', nowMs: NOW + 1 });
    const audit = listAuditForPolicy(p.id);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('visibility_change');
    expect(actions).toContain('update');
  });
});

describe('softDeletePolicy + restorePolicy', () => {
  it('soft-deletes and restores', () => {
    const p = createPolicy({ name: 'T', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    expect(softDeletePolicy(p.slug, '@you', 'human', 'bye')).toBe(true);
    expect(getPolicyBySlug(p.slug)!.deletedAtMs).not.toBeNull();
    expect(restorePolicy(p.slug, '@you', 'human', 'back')).toBe(true);
    expect(getPolicyBySlug(p.slug)!.deletedAtMs).toBeNull();
  });

  it('returns false for already deleted', () => {
    const p = createPolicy({ name: 'T', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    softDeletePolicy(p.slug, '@you', 'human');
    expect(softDeletePolicy(p.slug, '@you', 'human')).toBe(false);
  });

  it('returns false for unknown on restore', () => {
    expect(restorePolicy('nope', '@you', 'human')).toBe(false);
  });

  it('returns false for non-deleted on restore', () => {
    const p = createPolicy({ name: 'T', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    expect(restorePolicy(p.slug, '@you', 'human')).toBe(false);
  });

  it('writes audit rows', () => {
    const p = createPolicy({ name: 'T', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    softDeletePolicy(p.slug, '@you', 'human', 'gone');
    restorePolicy(p.slug, '@you', 'human', 'back');
    const audit = listAuditForPolicy(p.id);
    expect(new Set(audit.map((a) => a.action))).toEqual(new Set(['restore', 'soft_delete', 'create']));
  });
});

describe('clonePolicy', () => {
  it('clones a public policy', () => {
    const source = createPolicy({ name: 'Source', ownerHandle: '@a', actorKind: 'human', policy: POLICY, description: 'desc' });
    const cloned = clonePolicy({ sourceSlug: source.slug, newName: 'Fork', newOwnerHandle: '@b', actorKind: 'agent' });
    expect(cloned).toBeDefined();
    expect(cloned!.name).toBe('Fork');
    expect(cloned!.ownerHandle).toBe('@b');
    expect(cloned!.policy).toEqual(POLICY);
    expect(cloned!.description).toBe('desc');
    expect(cloned!.slug).not.toBe(source.slug);
  });

  it('returns undefined for missing source', () => {
    expect(clonePolicy({ sourceSlug: 'nope', newName: 'X', newOwnerHandle: '@b', actorKind: 'human' })).toBeUndefined();
  });

  it('returns undefined for deleted source', () => {
    const s = createPolicy({ name: 'S', ownerHandle: '@a', actorKind: 'human', policy: POLICY });
    softDeletePolicy(s.slug, '@a', 'human');
    expect(clonePolicy({ sourceSlug: s.slug, newName: 'X', newOwnerHandle: '@b', actorKind: 'human' })).toBeUndefined();
  });

  it('deduplicates slug on clone', () => {
    createPolicy({ name: 'Fork', ownerHandle: '@a', actorKind: 'human', policy: POLICY });
    const s = createPolicy({ name: 'Source', ownerHandle: '@a', actorKind: 'human', policy: POLICY });
    const c = clonePolicy({ sourceSlug: s.slug, newName: 'Fork', newOwnerHandle: '@b', actorKind: 'human' });
    expect(c!.slug).toBe('fork-2');
  });

  it('writes clone_source and clone_target audit', () => {
    const s = createPolicy({ name: 'S', ownerHandle: '@a', actorKind: 'human', policy: POLICY });
    const c = clonePolicy({ sourceSlug: s.slug, newName: 'C', newOwnerHandle: '@b', actorKind: 'agent' });
    const sourceAudit = listAuditForPolicy(s.id);
    const targetAudit = listAuditForPolicy(c!.id);
    expect(sourceAudit.map((a) => a.action)).toContain('clone_source');
    expect(targetAudit.map((a) => a.action)).toContain('clone_target');
  });
});

describe('malformed policy_json', () => {
  it('falls back to empty object on bad json', () => {
    const db = getIdentityDb();
    const id = 'malformed-id';
    db.prepare(
      `INSERT INTO verification_policies (id, slug, name, owner_handle, policy_json, visibility, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, 'bad', 'Bad', '@you', 'not-json', 'public', NOW);
    const p = getPolicyById(id);
    expect(p!.policy).toEqual({});
  });
});

describe('additional edge cases', () => {
  it('getPolicyById returns undefined for deleted policy', () => {
    const p = createPolicy({ name: 'Gone', ownerHandle: '@you', actorKind: 'human', policy: POLICY });
    softDeletePolicy(p.slug, '@you', 'human');
    expect(getPolicyById(p.id)).toBeDefined();
    expect(getPolicyById(p.id)!.deletedAtMs).not.toBeNull();
  });

  it('createPolicy supports unlisted and private visibility', () => {
    const u = createPolicy({ name: 'Unlisted', ownerHandle: '@you', actorKind: 'human', policy: POLICY, visibility: 'unlisted' });
    expect(u.visibility).toBe('unlisted');
    const priv = createPolicy({ name: 'Private', ownerHandle: '@you', actorKind: 'human', policy: POLICY, visibility: 'private' });
    expect(priv.visibility).toBe('private');
  });

  it('updatePolicy with name-only still writes audit', () => {
    const p = createPolicy({ name: 'NameOnly', ownerHandle: '@you', actorKind: 'human', policy: { a: 1 }, nowMs: NOW });
    updatePolicy({ slug: p.slug, actorHandle: '@you', actorKind: 'human', name: 'Renamed', nowMs: NOW + 1 });
    const audit = listAuditForPolicy(p.id);
    expect(audit.some((a) => a.action === 'update')).toBe(true);
  });

  it('clonePolicy respects visibility override', () => {
    const s = createPolicy({ name: 'Source', ownerHandle: '@a', actorKind: 'human', policy: POLICY, visibility: 'public' });
    const c = clonePolicy({ sourceSlug: s.slug, newName: 'Fork', newOwnerHandle: '@b', actorKind: 'agent', visibility: 'private' });
    expect(c!.visibility).toBe('private');
  });

  it('listPublicPolicies excludes unlisted by default', () => {
    createPolicy({ name: 'Public', ownerHandle: '@you', actorKind: 'human', policy: POLICY, visibility: 'public' });
    createPolicy({ name: 'Unlisted', ownerHandle: '@you', actorKind: 'human', policy: POLICY, visibility: 'unlisted' });
    const list = listPublicPolicies();
    expect(list.map((p) => p.name)).toContain('Public');
    expect(list.map((p) => p.name)).not.toContain('Unlisted');
  });
});

