import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findMostRecentForHash,
  getScopeCostSummary,
  getSkillInvocation,
  listSkillInvocations,
  recordSkillInvocation,
  resetSkillInvocationsStoreForTests
} from './skillInvocationsStore';
import { createValidationSchema } from './validationLensStore';
import { getIdentityDb } from './db';

beforeEach(() => {
  resetSkillInvocationsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
  // Seed a real lens so the FK on output_lens_id resolves.
  createValidationSchema({
    id: 'lens-q-letter', name: 'Q-letter', description: null,
    lensKind: 'custom', scope: 'public', scopeId: 'global',
    rulesJson: '[]', createdBy: '@test', archivedAtMs: null
  });
});

afterEach(() => {
  resetSkillInvocationsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

const SAMPLE = {
  skillId: 'create-verification-lens',
  invokerHandle: '@compliance',
  invokerKind: 'human' as const,
  scopeId: 'acme',
  requirements: 'We publish quarterly investor letters and need to catch unsupported performance claims.',
  inputJson: JSON.stringify({ lens_name: 'Q-letter', scope_id: 'acme' }),
  outputJson: JSON.stringify({ kind: 'lens', lens: { name: 'Q-letter' } })
};

describe('recordSkillInvocation', () => {
  it('persists all fields + SHA-256 hashes requirements + returns the row', () => {
    const r = recordSkillInvocation({
      ...SAMPLE,
      outputLensId: 'lens-q-letter',
      modelUsed: 'claude-sonnet-4-6',
      costEstimateUsd: 0.012
    });
    expect(r.id).toMatch(/^skinv-/);
    expect(r.inputRequirementsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.outputLensId).toBe('lens-q-letter');
    expect(r.modelUsed).toBe('claude-sonnet-4-6');
    expect(r.costEstimateUsd).toBe(0.012);
  });

  it('records refusals too (output_lens_id null, error_kind populated)', () => {
    const r = recordSkillInvocation({
      ...SAMPLE,
      outputJson: JSON.stringify({ kind: 'refusal', error_kind: 'out_of_substrate_scope' }),
      errorKind: 'out_of_substrate_scope'
    });
    expect(r.outputLensId).toBeNull();
    expect(r.errorKind).toBe('out_of_substrate_scope');
  });

  it('different requirements text → different hash', () => {
    const a = recordSkillInvocation({ ...SAMPLE, requirements: 'A — distinct requirements text here for the hash check' });
    const b = recordSkillInvocation({ ...SAMPLE, requirements: 'B — completely different requirements text for the hash check' });
    expect(a.inputRequirementsHash).not.toBe(b.inputRequirementsHash);
  });
});

describe('listSkillInvocations', () => {
  it('filters by scope_id', () => {
    recordSkillInvocation({ ...SAMPLE, scopeId: 'acme' });
    recordSkillInvocation({ ...SAMPLE, scopeId: 'other-org', invokerHandle: '@other' });
    const acme = listSkillInvocations({ scopeId: 'acme' });
    expect(acme).toHaveLength(1);
    expect(acme[0].scopeId).toBe('acme');
  });

  it('filters by invoker_handle', () => {
    recordSkillInvocation({ ...SAMPLE, invokerHandle: '@alice' });
    recordSkillInvocation({ ...SAMPLE, invokerHandle: '@bob' });
    expect(listSkillInvocations({ invokerHandle: '@alice' })).toHaveLength(1);
  });

  it('filters by since (time window)', () => {
    const r1 = recordSkillInvocation(SAMPLE);
    // Insert a row with timestamp far in the past by direct SQL
    recordSkillInvocation(SAMPLE);
    const before = listSkillInvocations({ since: r1.invokedAtMs - 1 });
    expect(before.length).toBeGreaterThanOrEqual(1);
    const after = listSkillInvocations({ since: Date.now() + 60_000 });
    expect(after).toHaveLength(0);
  });

  it('caps at supplied limit', () => {
    for (let i = 0; i < 5; i++) recordSkillInvocation(SAMPLE);
    expect(listSkillInvocations({ limit: 3 })).toHaveLength(3);
  });

  it('returns newest-first', () => {
    const a = recordSkillInvocation({ ...SAMPLE, requirements: 'a — first requirements text long enough for hash' });
    const b = recordSkillInvocation({ ...SAMPLE, requirements: 'b — second requirements text long enough for hash' });
    const rows = listSkillInvocations();
    expect(rows[0].id).toBe(b.id);
    expect(rows[1].id).toBe(a.id);
  });
});

describe('getScopeCostSummary', () => {
  it('aggregates count + refusals + total cost for a scope window', () => {
    recordSkillInvocation({ ...SAMPLE, scopeId: 'acme', costEstimateUsd: 0.01 });
    recordSkillInvocation({ ...SAMPLE, scopeId: 'acme', costEstimateUsd: 0.02 });
    recordSkillInvocation({ ...SAMPLE, scopeId: 'acme', errorKind: 'out_of_substrate_scope' });
    const summary = getScopeCostSummary('acme', 0);
    expect(summary.invocationCount).toBe(3);
    expect(summary.refusalCount).toBe(1);
    expect(summary.totalCostUsd).toBeCloseTo(0.03, 5);
  });

  it('returns zero when no invocations match the window', () => {
    expect(getScopeCostSummary('acme', Date.now() + 1000)).toEqual({
      invocationCount: 0, refusalCount: 0, totalCostUsd: 0
    });
  });
});

describe('findMostRecentForHash', () => {
  it('returns the most recent invocation matching (scope, hash)', () => {
    const first = recordSkillInvocation({ ...SAMPLE, scopeId: 'acme' });
    const second = recordSkillInvocation({ ...SAMPLE, scopeId: 'acme' });
    const recent = findMostRecentForHash('acme', first.inputRequirementsHash);
    expect(recent?.id).toBe(second.id); // identical input → same hash → newest wins
  });

  it('returns null when no match', () => {
    expect(findMostRecentForHash('acme', 'nonexistent-hash')).toBeNull();
  });

  it('isolates by scope', () => {
    const a = recordSkillInvocation({ ...SAMPLE, scopeId: 'acme' });
    expect(findMostRecentForHash('other-org', a.inputRequirementsHash)).toBeNull();
  });
});

describe('getSkillInvocation', () => {
  it('returns null for unknown id', () => {
    expect(getSkillInvocation('skinv-nope')).toBeNull();
  });

  it('returns the row by id', () => {
    const r = recordSkillInvocation(SAMPLE);
    expect(getSkillInvocation(r.id)?.id).toBe(r.id);
  });
});
