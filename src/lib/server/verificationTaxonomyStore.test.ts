import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTag,
  deprecateTag,
  editTag,
  getLatestTagVersion,
  getTagVersion,
  listLifecycleEventsForTag,
  listTaxonomy,
  resetVerificationTaxonomyStoreForTests
} from './verificationTaxonomyStore';
import {
  getDefaultTaxonomyIds,
  seedDefaultTaxonomy
} from './verificationTaxonomySeed';

beforeEach(() => {
  resetVerificationTaxonomyStoreForTests();
});

afterEach(() => {
  resetVerificationTaxonomyStoreForTests();
});

describe('createTag', () => {
  it('creates a tag at version 1 with a create lifecycle event', () => {
    const def = createTag({
      id: 'test.claim',
      name: 'Test claim',
      description: 'A test claim tag.',
      category: 'claim',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@you',
      actorKind: 'human',
      initialLifecycleState: 'active'
    });
    expect(def.version).toBe(1);
    expect(def.lifecycleState).toBe('active');
    const events = listLifecycleEventsForTag('test.claim');
    expect(events).toHaveLength(1);
    expect(events[0].eventKind).toBe('create');
    expect(events[0].actorHandle).toBe('@you');
  });

  it('rejects creating a tag id that already exists', () => {
    createTag({
      id: 'dup.test',
      name: 'Duplicate test',
      description: 'd',
      category: 'test',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@you'
    });
    expect(() =>
      createTag({
        id: 'dup.test',
        name: 'Duplicate again',
        description: 'd',
        category: 'test',
        provenance: 'system',
        scopeId: 'global',
        protocolResolver: { kind: 'static', protocol: 'deterministic' },
        isHumanEditable: true,
        isRelational: false,
        familyRoot: null,
        createdBy: '@you'
      })
    ).toThrow(/already exists/);
  });

  it('defaults org-provenance tags to lifecycle_state=proposed', () => {
    const def = createTag({
      id: 'org.acme.test',
      name: 'Acme test tag',
      description: 'd',
      category: 'test',
      provenance: 'org',
      scopeId: 'acme',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@acme-admin'
    });
    expect(def.lifecycleState).toBe('proposed');
  });
});

describe('editTag', () => {
  it('publishes a new version retaining the old one', () => {
    createTag({
      id: 'edit.test',
      name: 'Original',
      description: 'first',
      category: 'test',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@you',
      initialLifecycleState: 'active'
    });
    const edited = editTag({
      id: 'edit.test',
      name: 'Edited',
      description: 'second',
      actorHandle: '@editor',
      reason: 'tightening description'
    });
    expect(edited.version).toBe(2);
    expect(edited.name).toBe('Edited');
    const v1 = getTagVersion('edit.test', 1);
    expect(v1?.name).toBe('Original');
    const v2 = getTagVersion('edit.test', 2);
    expect(v2?.name).toBe('Edited');
    const events = listLifecycleEventsForTag('edit.test');
    expect(events.map((e) => e.eventKind)).toEqual(['edit', 'create']);
  });
});

describe('deprecateTag', () => {
  it('soft-deprecates without losing prior versions', () => {
    createTag({
      id: 'dep.test',
      name: 'Will be deprecated',
      description: 'd',
      category: 'test',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@you',
      initialLifecycleState: 'active'
    });
    const dep = deprecateTag({
      id: 'dep.test',
      actorHandle: '@deprecator',
      reason: 'no longer needed'
    });
    expect(dep.lifecycleState).toBe('deprecated');
    expect(getTagVersion('dep.test', 1)?.name).toBe('Will be deprecated');
    const events = listLifecycleEventsForTag('dep.test');
    expect(events[0].eventKind).toBe('deprecate');
    expect(events[0].reason).toBe('no longer needed');
  });

  it('supersedes when a replacement tag id is provided', () => {
    createTag({
      id: 'old.tag',
      name: 'Old',
      description: 'd',
      category: 'test',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@you',
      initialLifecycleState: 'active'
    });
    const dep = deprecateTag({
      id: 'old.tag',
      actorHandle: '@admin',
      reason: 'replaced',
      replacementTagId: 'new.tag'
    });
    expect(dep.lifecycleState).toBe('superseded');
    expect(dep.supersededById).toBe('new.tag');
    const events = listLifecycleEventsForTag('old.tag');
    expect(events[0].eventKind).toBe('supersede');
  });
});

describe('listTaxonomy', () => {
  it('returns latest version per id by default', () => {
    createTag({
      id: 'list.a',
      name: 'A',
      description: 'd',
      category: 'cat',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@you',
      initialLifecycleState: 'active'
    });
    editTag({ id: 'list.a', name: 'A-v2', actorHandle: '@you' });
    const all = listTaxonomy();
    expect(all).toHaveLength(1);
    expect(all[0].version).toBe(2);
  });

  it('filters by category', () => {
    createTag({
      id: 'cat1.x',
      name: 'X',
      description: 'd',
      category: 'cat1',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@you',
      initialLifecycleState: 'active'
    });
    createTag({
      id: 'cat2.y',
      name: 'Y',
      description: 'd',
      category: 'cat2',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@you',
      initialLifecycleState: 'active'
    });
    const cat1Only = listTaxonomy({ category: 'cat1' });
    expect(cat1Only.map((t) => t.id)).toEqual(['cat1.x']);
  });
});

describe('seedDefaultTaxonomy', () => {
  it('seeds the default tag set on a fresh DB', () => {
    const seeded = seedDefaultTaxonomy();
    expect(seeded.length).toBeGreaterThan(20); // ~25 tags
    const ids = listTaxonomy().map((t) => t.id);
    expect(ids).toContain('claim.factual');
    expect(ids).toContain('source.primary');
    expect(ids).toContain('source.supports-claim'); // relational family root
    expect(ids).toContain('source.refutes-claim');
    expect(ids).toContain('link.html');
    expect(ids).toContain('process.flagged-ignorable');
  });

  it('is idempotent — re-seeding does not throw or duplicate', () => {
    const first = seedDefaultTaxonomy();
    const second = seedDefaultTaxonomy();
    expect(second).toHaveLength(0); // nothing new the second time
    const ids = new Set(listTaxonomy().map((t) => t.id));
    expect(ids.size).toBe(first.length);
  });

  it('marks all defaults as system-provenance + active', () => {
    seedDefaultTaxonomy();
    const tags = listTaxonomy();
    for (const t of tags) {
      expect(t.provenance).toBe('system');
      expect(t.lifecycleState).toBe('active');
      expect(t.scopeId).toBe('global');
    }
  });

  it('the relational tag families have is_relational=1 + family_root set', () => {
    seedDefaultTaxonomy();
    const supports = getLatestTagVersion('source.supports-claim');
    expect(supports?.isRelational).toBe(true);
    expect(supports?.familyRoot).toBe('source.supports-claim');
    const refutes = getLatestTagVersion('source.refutes-claim');
    expect(refutes?.isRelational).toBe(true);
    expect(refutes?.familyRoot).toBe('source.refutes-claim');
  });

  it('claim.factual uses a conditional protocol resolver (deterministic when primary source exists, judgement-required otherwise)', () => {
    seedDefaultTaxonomy();
    const claim = getLatestTagVersion('claim.factual');
    expect(claim?.protocolResolver.kind).toBe('conditional');
    if (claim?.protocolResolver.kind === 'conditional') {
      expect(claim.protocolResolver.rules[0].protocol).toBe('deterministic');
      expect(claim.protocolResolver.default).toBe('judgement-required');
    }
  });

  it('source.agent-generated and source.supports/refutes-claim use the consensus-required protocol', () => {
    seedDefaultTaxonomy();
    expect(getLatestTagVersion('source.agent-generated')?.protocolResolver).toEqual({
      kind: 'static',
      protocol: 'consensus-required'
    });
    expect(getLatestTagVersion('source.supports-claim')?.protocolResolver).toEqual({
      kind: 'static',
      protocol: 'consensus-required'
    });
    expect(getLatestTagVersion('source.refutes-claim')?.protocolResolver).toEqual({
      kind: 'static',
      protocol: 'consensus-required'
    });
  });

  it('all default tag ids are accessible via getDefaultTaxonomyIds', () => {
    const ids = getDefaultTaxonomyIds();
    expect(ids.length).toBeGreaterThan(20);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });
});

describe('audit-of-flagger', () => {
  it('every lifecycle event captures actor_handle + actor_kind + (optional) reason', () => {
    createTag({
      id: 'audit.test',
      name: 'A',
      description: 'd',
      category: 'cat',
      provenance: 'system',
      scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'deterministic' },
      isHumanEditable: true,
      isRelational: false,
      familyRoot: null,
      createdBy: '@creator',
      actorKind: 'human',
      initialLifecycleState: 'active',
      createReason: 'initial'
    });
    editTag({
      id: 'audit.test',
      name: 'B',
      actorHandle: '@editor',
      actorKind: 'human',
      reason: 'rename'
    });
    deprecateTag({
      id: 'audit.test',
      actorHandle: '@deprecator',
      reason: 'stale'
    });
    const events = listLifecycleEventsForTag('audit.test');
    expect(events).toHaveLength(3);
    // Newest-first order
    expect(events[0].eventKind).toBe('deprecate');
    expect(events[0].actorHandle).toBe('@deprecator');
    expect(events[0].reason).toBe('stale');
    expect(events[1].eventKind).toBe('edit');
    expect(events[1].actorHandle).toBe('@editor');
    expect(events[2].eventKind).toBe('create');
    expect(events[2].actorHandle).toBe('@creator');
  });
});
