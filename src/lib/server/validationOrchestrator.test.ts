import { describe, expect, it } from 'vitest';
import { JKS_VALIDATION_RULE_POLICY } from './validationPolicyPresets';
import { planValidationOrchestration, type ValidationParticipant } from './validationOrchestrator';
import type { ValidationClaimPointer } from './validationScoring';

const participants: ValidationParticipant[] = [
  { kind: 'agent', handle: '@agent-a' },
  { kind: 'agent', handle: '@agent-b' },
  { kind: 'agent', handle: '@agent-c' },
  { kind: 'human', handle: '@human-a' },
  { kind: 'file', handle: 'speed-pact-deck.html' },
  { kind: 'context_summary', handle: 'speed-pact-room-summary' }
];

function claim(id: string, kind: string): ValidationClaimPointer {
  return {
    id,
    kind,
    text: `${kind} claim`,
    source: { tool: 'deck', pointer: `slide:${id}` },
    checks: []
  };
}

describe('planValidationOrchestration', () => {
  it('routes JKs material claims to agents plus a human interview slot', () => {
    const plan = planValidationOrchestration({
      policy: JKS_VALIDATION_RULE_POLICY,
      claims: [claim('c1', 'claim_material')],
      participants
    });

    expect(plan.claimPlans).toHaveLength(1);
    expect(plan.claimPlans[0].assignments).toEqual([
      { verifierKind: 'agent', handle: '@agent-a', transport: 'heads_down', reason: '2 agents' },
      { verifierKind: 'agent', handle: '@agent-b', transport: 'heads_down', reason: '2 agents' },
      { verifierKind: 'human', handle: '@human-a', transport: 'interview', reason: 'AND 1 humans' }
    ]);
    expect(plan.claimPlans[0].missing).toEqual([]);
    expect(plan.summary.totalClaims).toBe(1);
    expect(plan.summary.readyClaims).toBe(1);
  });

  it('uses policy alternatives when the primary route is under-supplied', () => {
    const plan = planValidationOrchestration({
      policy: JKS_VALIDATION_RULE_POLICY,
      claims: [claim('c2', 'number'), claim('c3', 'link')],
      participants: [
        { kind: 'agent', handle: '@agent-a' },
        { kind: 'human', handle: '@human-a' },
        { kind: 'file', handle: 'speed-pact-deck.html' }
      ]
    });

    expect(plan.claimPlans[0].assignments).toEqual([
      { verifierKind: 'agent', handle: '@agent-a', transport: 'heads_down', reason: 'OR 1 agents + 1 file' },
      { verifierKind: 'file', handle: 'speed-pact-deck.html', transport: 'artefact_check', reason: 'OR 1 agents + 1 file' }
    ]);
    expect(plan.claimPlans[1].assignments).toEqual([
      { verifierKind: 'human', handle: '@human-a', transport: 'interview', reason: 'OR 1 humans' }
    ]);
    expect(plan.summary.readyClaims).toBe(2);
  });

  it('reports missing slots instead of inventing validators', () => {
    const plan = planValidationOrchestration({
      policy: JKS_VALIDATION_RULE_POLICY,
      claims: [claim('c4', 'document_broad')],
      participants: [{ kind: 'agent', handle: '@agent-a' }]
    });

    expect(plan.claimPlans[0].assignments).toEqual([
      { verifierKind: 'agent', handle: '@agent-a', transport: 'heads_down', reason: '3 agents' }
    ]);
    expect(plan.claimPlans[0].missing).toEqual([
      { verifierKind: 'agent', count: 2, reason: '3 agents' }
    ]);
    expect(plan.summary.readyClaims).toBe(0);
    expect(plan.summary.blockedClaims).toBe(1);
  });
});
