import { describe, expect, it } from 'vitest';
import { JKS_VALIDATION_RULE_POLICY } from './validationPolicyPresets';
import { scoreValidationClaims, type ValidationClaimPointer } from './validationScoring';

describe('scoreValidationClaims', () => {
  it('scores claim pointers against JKs rule without parsing source documents', () => {
    const claims: ValidationClaimPointer[] = [
      {
        id: 'claim-material',
        kind: 'claim_material',
        source: { tool: 'deck', pointer: 'slide:2#headline' },
        text: 'Speed Pact has three lanes.',
        checks: [
          { verifierKind: 'agent', outcome: 'pass' },
          { verifierKind: 'agent', outcome: 'pass' },
          { verifierKind: 'human', outcome: 'pass' }
        ]
      },
      {
        id: 'claim-nonmaterial',
        kind: 'claim_nonmaterial',
        source: { tool: 'deck', pointer: 'slide:4#note' },
        text: 'Cadence note is readable.',
        checks: [{ verifierKind: 'agent', outcome: 'pass' }]
      },
      {
        id: 'claim-number',
        kind: 'number',
        source: { tool: 'sheet', pointer: 'A7' },
        text: 'The deck contains 10 Speed Pact tasks.',
        checks: [
          { verifierKind: 'agent', outcome: 'pass' },
          { verifierKind: 'file', outcome: 'pass' }
        ]
      },
      {
        id: 'claim-source-quality',
        kind: 'source_quality',
        source: { tool: 'doc', pointer: 'paragraph:8' },
        text: 'The source is high quality.',
        checks: [{ verifierKind: 'human', outcome: 'pass' }]
      },
      {
        id: 'claim-fallback',
        kind: 'unmapped_kind',
        source: { tool: 'notion', pointer: 'block:abc' },
        text: 'Unknown claim kind falls back.',
        checks: [{ verifierKind: 'human', outcome: 'pass' }]
      }
    ];

    const score = scoreValidationClaims(JKS_VALIDATION_RULE_POLICY, claims);

    expect(score.totalClaims).toBe(5);
    expect(score.passedClaims).toBe(4);
    expect(score.percent).toBe(80);
    expect(score.claimResults.map((result) => [result.id, result.passed])).toEqual([
      ['claim-material', true],
      ['claim-nonmaterial', false],
      ['claim-number', true],
      ['claim-source-quality', true],
      ['claim-fallback', true]
    ]);
  });

  it('ignores failed verifier outcomes when counting pass evidence', () => {
    const score = scoreValidationClaims(JKS_VALIDATION_RULE_POLICY, [
      {
        id: 'material',
        kind: 'claim_material',
        source: { tool: 'deck', pointer: 'slide:1' },
        text: 'Material claim.',
        checks: [
          { verifierKind: 'agent', outcome: 'pass' },
          { verifierKind: 'agent', outcome: 'fail' },
          { verifierKind: 'human', outcome: 'pass' }
        ]
      }
    ]);

    expect(score.passedClaims).toBe(0);
    expect(score.claimResults[0].passed).toBe(false);
    expect(score.claimResults[0].required).toContain('2 agents');
  });
});
