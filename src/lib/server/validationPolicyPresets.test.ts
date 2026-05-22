import { beforeEach, describe, expect, it } from 'vitest';
import { getPolicyBySlug, listAuditForPolicy, resetPolicyStoreForTests } from './policyStore';
import { resetIdentityDbForTests } from './db';
import {
  JKS_VALIDATION_RULE_POLICY,
  JKS_VALIDATION_RULE_SLUG,
  ensureJksValidationRulePolicy
} from './validationPolicyPresets';

beforeEach(() => {
  resetIdentityDbForTests();
  resetPolicyStoreForTests();
});

describe('ensureJksValidationRulePolicy', () => {
  it('creates JKs validation rule as an audited public policy', () => {
    const policy = ensureJksValidationRulePolicy({
      ownerHandle: '@jwpk',
      actorKind: 'human',
      nowMs: 1779000000000
    });

    expect(policy.slug).toBe(JKS_VALIDATION_RULE_SLUG);
    expect(policy.name).toBe("JK's Validation Rule");
    expect(policy.ownerHandle).toBe('@jwpk');
    expect(policy.visibility).toBe('public');
    expect(policy.policy).toEqual(JKS_VALIDATION_RULE_POLICY);
    expect(getPolicyBySlug(JKS_VALIDATION_RULE_SLUG)?.id).toBe(policy.id);

    const audit = listAuditForPolicy(policy.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('create');
    expect(audit[0].reason).toContain('Validation v1');
  });

  it('returns the existing rule without writing duplicate audit rows', () => {
    const first = ensureJksValidationRulePolicy({
      ownerHandle: '@jwpk',
      actorKind: 'human',
      nowMs: 1779000000000
    });
    const second = ensureJksValidationRulePolicy({
      ownerHandle: '@codex2fast',
      actorKind: 'agent',
      nowMs: 1779000001000
    });

    expect(second.id).toBe(first.id);
    expect(second.ownerHandle).toBe('@jwpk');
    expect(listAuditForPolicy(first.id).map((entry) => entry.action)).toEqual(['create']);
  });
});
