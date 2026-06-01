import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb } from './db';
import {
  addMember,
  createSourceSet,
  deprecateSourceSet,
  findSetsContaining,
  getSourceSet,
  listAuditForSet,
  listMembersForSet,
  listSourceSets,
  recordReviewCheckpoint,
  removeMember,
  resetSourceSetsStoreForTests,
  restoreSourceSet,
  updateSourceSet
} from './sourceSetsStore';

beforeEach(() => {
  resetSourceSetsStoreForTests();
});

afterEach(() => {
  resetSourceSetsStoreForTests();
});

describe('createSourceSet', () => {
  it('creates a set with default fields + a create audit event', () => {
    const set = createSourceSet({
      name: 'NMVC reputable sources',
      ownerOrg: 'nmvc',
      createdBy: '@james',
      createReason: 'initial baseline'
    });
    expect(set.name).toBe('NMVC reputable sources');
    expect(set.ownerOrg).toBe('nmvc');
    expect(set.scopeKind).toBe('org-wide');
    expect(set.boundLensId).toBeNull();
    expect(set.approvers).toEqual([]);
    expect(set.lifecycleState).toBe('active');
    const audit = listAuditForSet(set.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].eventKind).toBe('create');
    expect(audit[0].actorHandle).toBe('@james');
    expect(audit[0].reason).toBe('initial baseline');
  });

  it('supports lens-specific scope with bound_lens_id', () => {
    const set = createSourceSet({
      name: 'FCA PE FO Lens sources',
      ownerOrg: 'nmvc',
      scopeKind: 'lens-specific',
      boundLensId: 'lens-fca-pe-fo',
      approvers: ['@james', '@compliance-officer'],
      createdBy: '@james'
    });
    expect(set.scopeKind).toBe('lens-specific');
    expect(set.boundLensId).toBe('lens-fca-pe-fo');
    expect(set.approvers).toEqual(['@james', '@compliance-officer']);
  });
});

describe('updateSourceSet', () => {
  it('updates name + records a rename audit event with before/after', () => {
    const set = createSourceSet({ name: 'Original', ownerOrg: 'nmvc', createdBy: '@james' });
    const updated = updateSourceSet({
      id: set.id,
      name: 'Renamed',
      actorHandle: '@james',
      reason: 'clearer naming'
    });
    expect(updated?.name).toBe('Renamed');
    const audit = listAuditForSet(set.id);
    // Newest-first ordering: rename event comes before create
    expect(audit[0].eventKind).toBe('rename');
    expect(audit[0].reason).toBe('clearer naming');
  });

  it('emits add_approver + remove_approver events per delta, not just one rename event', () => {
    const set = createSourceSet({
      name: 'S',
      ownerOrg: 'nmvc',
      approvers: ['@alice'],
      createdBy: '@james'
    });
    updateSourceSet({
      id: set.id,
      approvers: ['@bob', '@carol'], // removes @alice, adds @bob + @carol
      actorHandle: '@james',
      reason: 'rotation'
    });
    const audit = listAuditForSet(set.id);
    const kinds = audit.map((e) => e.eventKind);
    // Should have: add_approver x2, remove_approver x1, create
    // (order is newest-first; sort by kind to assert presence)
    expect(kinds.filter((k) => k === 'add_approver')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'remove_approver')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'create')).toHaveLength(1);
  });

  it('returns null when set does not exist', () => {
    const result = updateSourceSet({
      id: 'does-not-exist',
      name: 'X',
      actorHandle: '@james'
    });
    expect(result).toBeNull();
  });

  it('refuses to update a withdrawn set', () => {
    // Use direct SQL to simulate withdrawn state since the store
    // doesn't have a 'withdraw' verb (yet — it'd be a one-way
    // terminal transition; deprecate + restore is the round-trip).
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    getIdentityDb()
      .prepare("UPDATE source_sets SET lifecycle_state = 'withdrawn' WHERE id = ?")
      .run(set.id);
    const result = updateSourceSet({
      id: set.id,
      name: 'cannot rename',
      actorHandle: '@james'
    });
    expect(result).toBeNull();
  });
});

describe('deprecate + restore', () => {
  it('deprecate moves active → deprecated + writes deprecate event', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    const deprecated = deprecateSourceSet({
      id: set.id,
      actorHandle: '@james',
      reason: 'no longer relevant'
    });
    expect(deprecated?.lifecycleState).toBe('deprecated');
    const audit = listAuditForSet(set.id);
    expect(audit[0].eventKind).toBe('deprecate');
  });

  it('restore moves deprecated → active + writes restore event', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    deprecateSourceSet({ id: set.id, actorHandle: '@james' });
    const restored = restoreSourceSet({
      id: set.id,
      actorHandle: '@james',
      reason: 'still useful after all'
    });
    expect(restored?.lifecycleState).toBe('active');
    const audit = listAuditForSet(set.id);
    expect(audit[0].eventKind).toBe('restore');
  });

  it('deprecate is a no-op on already-deprecated sets', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    deprecateSourceSet({ id: set.id, actorHandle: '@james' });
    const beforeAudit = listAuditForSet(set.id).length;
    deprecateSourceSet({ id: set.id, actorHandle: '@james' });
    const afterAudit = listAuditForSet(set.id).length;
    expect(afterAudit).toBe(beforeAudit); // no new event
  });
});

describe('recordReviewCheckpoint', () => {
  it('updates last_reviewed_at_ms + writes a review_checkpoint event', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    expect(set.lastReviewedAtMs).toBeNull();
    const reviewed = recordReviewCheckpoint({
      id: set.id,
      actorHandle: '@james',
      reason: 'quarterly review'
    });
    expect(reviewed?.lastReviewedAtMs).toBeGreaterThan(0);
    const audit = listAuditForSet(set.id);
    expect(audit[0].eventKind).toBe('review_checkpoint');
  });
});

describe('listSourceSets', () => {
  it('filters by owner_org', () => {
    createSourceSet({ name: 'A', ownerOrg: 'nmvc', createdBy: '@james' });
    createSourceSet({ name: 'B', ownerOrg: 'other-org', createdBy: '@other' });
    const nmvc = listSourceSets({ ownerOrg: 'nmvc' });
    expect(nmvc).toHaveLength(1);
    expect(nmvc[0].name).toBe('A');
  });

  it('filters by bound_lens_id', () => {
    createSourceSet({
      name: 'lens-X sources',
      ownerOrg: 'nmvc',
      scopeKind: 'lens-specific',
      boundLensId: 'lens-X',
      createdBy: '@james'
    });
    createSourceSet({
      name: 'org-wide sources',
      ownerOrg: 'nmvc',
      createdBy: '@james'
    });
    const lensX = listSourceSets({ boundLensId: 'lens-X' });
    expect(lensX).toHaveLength(1);
    expect(lensX[0].name).toBe('lens-X sources');
  });

  it('filters by lifecycle state', () => {
    const a = createSourceSet({ name: 'A', ownerOrg: 'nmvc', createdBy: '@james' });
    createSourceSet({ name: 'B', ownerOrg: 'nmvc', createdBy: '@james' });
    deprecateSourceSet({ id: a.id, actorHandle: '@james' });
    const active = listSourceSets({ lifecycleStates: ['active'] });
    const deprecated = listSourceSets({ lifecycleStates: ['deprecated'] });
    expect(active.map((s) => s.name)).toEqual(['B']);
    expect(deprecated.map((s) => s.name)).toEqual(['A']);
  });
});

describe('addMember', () => {
  it('adds a member + records add_member audit event', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    const member = addMember({
      setId: set.id,
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      label: 'FCA primary domain',
      addedBy: '@james',
      addedReason: 'core regulator'
    });
    expect(member.memberKind).toBe('domain');
    expect(member.memberValue).toBe('fca.org.uk');
    expect(member.removedAtMs).toBeNull();
    const audit = listAuditForSet(set.id);
    const addEvents = audit.filter((e) => e.eventKind === 'add_member');
    expect(addEvents).toHaveLength(1);
    expect(addEvents[0].reason).toBe('core regulator');
  });

  it('is idempotent on (set_id, member_kind, member_value) — returns existing active row', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    const first = addMember({
      setId: set.id,
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      addedBy: '@james'
    });
    const second = addMember({
      setId: set.id,
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      addedBy: '@james',
      addedReason: 'duplicate attempt'
    });
    expect(second.id).toBe(first.id);
    // No duplicate add_member event
    const addEvents = listAuditForSet(set.id).filter((e) => e.eventKind === 'add_member');
    expect(addEvents).toHaveLength(1);
  });

  it('allows re-adding a previously-removed member as a new row', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    const first = addMember({
      setId: set.id,
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      addedBy: '@james'
    });
    removeMember({ memberId: first.id, removedBy: '@james', removedReason: 'temporarily' });
    const reAdded = addMember({
      setId: set.id,
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      addedBy: '@james',
      addedReason: 'changed mind'
    });
    // Re-add creates a NEW row (the prior one stays removed in history)
    expect(reAdded.id).not.toBe(first.id);
    // listMembersForSet (active-only default) returns just the new one
    const active = listMembersForSet(set.id);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(reAdded.id);
    // includeRemoved returns both
    const all = listMembersForSet(set.id, { includeRemoved: true });
    expect(all).toHaveLength(2);
  });
});

describe('removeMember', () => {
  it('soft-removes a member (sets removed_at_ms) + writes audit event', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    const member = addMember({
      setId: set.id,
      memberKind: 'url',
      memberValue: 'https://fca.org.uk/handbook',
      addedBy: '@james'
    });
    const removed = removeMember({
      memberId: member.id,
      removedBy: '@james',
      removedReason: 'broken link'
    });
    expect(removed?.removedAtMs).toBeGreaterThan(0);
    expect(removed?.removedReason).toBe('broken link');
    // Member is excluded from default listing
    expect(listMembersForSet(set.id)).toHaveLength(0);
    // But still present with includeRemoved
    expect(listMembersForSet(set.id, { includeRemoved: true })).toHaveLength(1);
  });
});

describe('findSetsContaining', () => {
  it('finds sets that have the value as a current active member', () => {
    const setA = createSourceSet({ name: 'A', ownerOrg: 'nmvc', createdBy: '@james' });
    const setB = createSourceSet({ name: 'B', ownerOrg: 'nmvc', createdBy: '@james' });
    addMember({
      setId: setA.id,
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      addedBy: '@james'
    });
    addMember({
      setId: setB.id,
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      addedBy: '@james'
    });
    addMember({
      setId: setB.id,
      memberKind: 'domain',
      memberValue: 'sec.gov',
      addedBy: '@james'
    });
    const hits = findSetsContaining({ memberKind: 'domain', memberValue: 'fca.org.uk' });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.set.name).sort()).toEqual(['A', 'B']);
  });

  it('excludes removed members by default', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@james' });
    const member = addMember({
      setId: set.id,
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      addedBy: '@james'
    });
    removeMember({ memberId: member.id, removedBy: '@james' });
    const hits = findSetsContaining({ memberKind: 'domain', memberValue: 'fca.org.uk' });
    expect(hits).toHaveLength(0);
  });

  it('filters by owner_org when provided', () => {
    const a = createSourceSet({ name: 'NMVC set', ownerOrg: 'nmvc', createdBy: '@james' });
    const b = createSourceSet({
      name: 'Other set',
      ownerOrg: 'other-org',
      createdBy: '@other'
    });
    addMember({ setId: a.id, memberKind: 'domain', memberValue: 'fca.org.uk', addedBy: '@james' });
    addMember({ setId: b.id, memberKind: 'domain', memberValue: 'fca.org.uk', addedBy: '@other' });
    const nmvcOnly = findSetsContaining({
      memberKind: 'domain',
      memberValue: 'fca.org.uk',
      ownerOrg: 'nmvc'
    });
    expect(nmvcOnly).toHaveLength(1);
    expect(nmvcOnly[0].set.ownerOrg).toBe('nmvc');
  });
});

describe('audit log ordering + structure', () => {
  it('returns events newest-first with rowid tie-break for same-ms ordering', () => {
    const set = createSourceSet({ name: 'S', ownerOrg: 'nmvc', createdBy: '@creator' });
    addMember({
      setId: set.id,
      memberKind: 'domain',
      memberValue: 'a.com',
      addedBy: '@adder'
    });
    deprecateSourceSet({ id: set.id, actorHandle: '@deprecator', reason: 'no longer needed' });
    const audit = listAuditForSet(set.id);
    expect(audit).toHaveLength(3);
    // Newest first: deprecate, then add_member, then create
    expect(audit.map((e) => e.eventKind)).toEqual(['deprecate', 'add_member', 'create']);
    // Audit-of-flagger: every event names actor + kind + (optional) reason
    expect(audit[0].actorHandle).toBe('@deprecator');
    expect(audit[0].reason).toBe('no longer needed');
    expect(audit[1].actorHandle).toBe('@adder');
    expect(audit[2].actorHandle).toBe('@creator');
  });
});
