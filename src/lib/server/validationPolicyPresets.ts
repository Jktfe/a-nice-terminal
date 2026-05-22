import {
  createPolicy,
  getPolicyBySlug,
  restorePolicy,
  type Policy,
  type PolicyActorKind,
  type PolicyBody
} from './policyStore';

export const JKS_VALIDATION_RULE_NAME = "JK's Validation Rule";
export const JKS_VALIDATION_RULE_SLUG = 'jks-validation-rule';

export const JKS_VALIDATION_RULE_POLICY: PolicyBody = {
  blocks: {
    claim_material: { agents: 2, AND_humans: 1 },
    claim_nonmaterial: { agents: 2 },
    link: { agents: 3, OR_humans: 1 },
    source_quality: { agents: 3, OR_humans: 1 },
    number: { agents: 2, OR_agentsPlusFile: [1, 1] },
    document_broad: { agents: 3, OR_agentsPlusContextSummary_humans: [1, 1, 1] }
  },
  fallback: { agents: 3, OR_humans: 1 }
};

export function ensureJksValidationRulePolicy(input: {
  ownerHandle: string;
  actorKind: PolicyActorKind;
  nowMs?: number;
}): Policy {
  const existing = getPolicyBySlug(JKS_VALIDATION_RULE_SLUG);
  if (existing?.deletedAtMs === null) return existing;

  if (existing?.deletedAtMs !== null && existing !== undefined) {
    restorePolicy(
      existing.slug,
      input.ownerHandle,
      input.actorKind,
      'Validation v1 restored JKs stored rule preset.',
      input.nowMs
    );
    return getPolicyBySlug(JKS_VALIDATION_RULE_SLUG)!;
  }

  return createPolicy({
    name: JKS_VALIDATION_RULE_NAME,
    description: 'Validation v1 preset for routing material claims, links, source quality, numbers, and broad document checks to agents and humans.',
    ownerHandle: input.ownerHandle,
    actorKind: input.actorKind,
    policy: JKS_VALIDATION_RULE_POLICY,
    visibility: 'public',
    reason: 'Validation v1 seeded JKs stored rule preset.',
    nowMs: input.nowMs
  });
}
