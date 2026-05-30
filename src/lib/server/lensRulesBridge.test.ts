import { describe, expect, it } from 'vitest';
import {
  extractAssignmentConstraints,
  lensRulesToPolicyBody,
  parseLensRulesJson,
  rulesJsonToPolicyBody
} from './lensRulesBridge';
import { scoreValidationClaims, type ValidationClaimPointer } from './validationScoring';
import { planValidationOrchestration } from './validationOrchestrator';

describe('parseLensRulesJson', () => {
  it('returns null on malformed JSON', () => {
    expect(parseLensRulesJson('not json')).toBeNull();
  });

  it('treats legacy "[]" as empty rules', () => {
    expect(parseLensRulesJson('[]')).toEqual({});
  });

  it('treats any non-object payload as empty rules', () => {
    expect(parseLensRulesJson('"a string"')).toEqual({});
    expect(parseLensRulesJson('42')).toEqual({});
    expect(parseLensRulesJson('null')).toEqual({});
  });

  it('parses the v2 shape with version=2 + blocks + fallback + waiver mode', () => {
    const raw = JSON.stringify({
      version: 2,
      blocks: {
        claim_material: {
          mode: 'all',
          requirements: [
            { kind: 'agent', count: 2, specific: ['@speedyclaude'] },
            { kind: 'person', count: 1, specific: ['@james'] },
            { kind: 'source', count: 1, allowedSources: ['board-pack'] }
          ]
        },
        opinion: {
          mode: 'none',
          reason: 'opinion claims do not require independent verification'
        }
      },
      fallback: {
        mode: 'any',
        requirements: [{ kind: 'agent', count: 1 }]
      }
    });
    const rules = parseLensRulesJson(raw);
    expect(rules?.version).toBe(2);
    expect(rules?.blocks?.claim_material.mode).toBe('all');
    expect(rules?.blocks?.claim_material.requirements).toHaveLength(3);
    expect(rules?.blocks?.opinion.mode).toBe('none');
    expect(rules?.blocks?.opinion.reason).toBe(
      'opinion claims do not require independent verification'
    );
    expect(rules?.fallback?.mode).toBe('any');
  });

  it('drops requirement rows with unknown kinds or non-positive counts', () => {
    const raw = JSON.stringify({
      blocks: {
        link: {
          mode: 'any',
          requirements: [
            { kind: 'agent', count: 1 },
            { kind: 'unknown_kind', count: 1 },
            { kind: 'person', count: 0 },
            { kind: 'website', count: 1, allowedDomains: ['fca.org.uk'] }
          ]
        }
      }
    });
    const rules = parseLensRulesJson(raw);
    expect(rules?.blocks?.link.requirements).toHaveLength(2);
    expect(rules?.blocks?.link.requirements?.map((r) => r.kind)).toEqual(['agent', 'website']);
  });

  it('drops blocks with empty requirement lists in non-waiver mode', () => {
    const raw = JSON.stringify({
      blocks: {
        empty_all: { mode: 'all', requirements: [] },
        waived: { mode: 'none', reason: 'waived' }
      }
    });
    const rules = parseLensRulesJson(raw);
    expect(rules?.blocks?.empty_all).toBeUndefined();
    expect(rules?.blocks?.waived?.mode).toBe('none');
  });
});

describe('lensRulesToPolicyBody', () => {
  it('returns an empty body for empty rules', () => {
    expect(lensRulesToPolicyBody({})).toEqual({});
  });

  it('lowers mode=any with agents+humans to OR_humans + agents', () => {
    const body = lensRulesToPolicyBody({
      blocks: {
        link: {
          mode: 'any',
          requirements: [
            { kind: 'agent', count: 2 },
            { kind: 'person', count: 1 }
          ]
        }
      }
    });
    expect(body.blocks).toEqual({
      link: { agents: 2, OR_humans: 1 }
    });
  });

  it('lowers mode=all with agents+humans to AND_humans + agents', () => {
    const body = lensRulesToPolicyBody({
      blocks: {
        claim_material: {
          mode: 'all',
          requirements: [
            { kind: 'agent', count: 2 },
            { kind: 'person', count: 1 }
          ]
        }
      }
    });
    expect(body.blocks).toEqual({
      claim_material: { agents: 2, AND_humans: 1 }
    });
  });

  it('lowers mode=none to an empty block (no requirement gates)', () => {
    const body = lensRulesToPolicyBody({
      blocks: {
        opinion: { mode: 'none', reason: 'waived' }
      }
    });
    expect(body.blocks).toEqual({ opinion: {} });
  });

  it('collapses file + filesystem + source-likes into OR_agentsPlusFile', () => {
    const body = lensRulesToPolicyBody({
      blocks: {
        number: {
          mode: 'any',
          requirements: [
            { kind: 'agent', count: 2 },
            { kind: 'file', count: 1 },
            { kind: 'website', count: 1 }
          ]
        }
      }
    });
    expect(body.blocks).toEqual({
      number: {
        agents: 2,
        OR_agentsPlusFile: [2, 2]
      }
    });
  });

  it('lowers the fallback block alongside per-kind blocks', () => {
    const body = lensRulesToPolicyBody({
      fallback: {
        mode: 'any',
        requirements: [{ kind: 'agent', count: 1 }]
      }
    });
    expect(body.fallback).toEqual({ agents: 1 });
  });
});

describe('extractAssignmentConstraints', () => {
  it('returns null when no specific-* / allowed-* fields are present', () => {
    const rules = parseLensRulesJson(
      JSON.stringify({
        blocks: {
          link: { mode: 'any', requirements: [{ kind: 'agent', count: 1 }] }
        }
      })
    )!;
    expect(extractAssignmentConstraints(rules)).toBeNull();
  });

  it('surfaces specific verifier handles per block kind', () => {
    const rules = parseLensRulesJson(
      JSON.stringify({
        blocks: {
          claim_material: {
            mode: 'all',
            requirements: [
              { kind: 'agent', count: 2, specific: ['@speedyclaude'] },
              { kind: 'person', count: 1, specific: ['@james'] }
            ]
          }
        }
      })
    )!;
    const constraints = extractAssignmentConstraints(rules);
    expect(constraints?.byBlockKind.claim_material.specific).toEqual(['@speedyclaude', '@james']);
  });

  it('surfaces allowedDomains + specificFiles + allowedSources', () => {
    const rules = parseLensRulesJson(
      JSON.stringify({
        blocks: {
          number: {
            mode: 'any',
            requirements: [
              { kind: 'website', count: 1, allowedDomains: ['fca.org.uk'] },
              { kind: 'file', count: 1, specificFiles: ['artefact:abc123'] },
              { kind: 'source', count: 1, allowedSources: ['board-pack'] }
            ]
          }
        }
      })
    )!;
    const constraints = extractAssignmentConstraints(rules);
    expect(constraints?.byBlockKind.number.allowedDomains).toEqual(['fca.org.uk']);
    expect(constraints?.byBlockKind.number.specificFiles).toEqual(['artefact:abc123']);
    expect(constraints?.byBlockKind.number.allowedSources).toEqual(['board-pack']);
  });
});

describe('rulesJsonToPolicyBody integration', () => {
  it('round-trips through the existing scorer + orchestrator', () => {
    const rulesJson = JSON.stringify({
      version: 2,
      blocks: {
        claim_material: {
          mode: 'all',
          requirements: [
            { kind: 'agent', count: 2 },
            { kind: 'person', count: 1 }
          ]
        }
      },
      fallback: {
        mode: 'any',
        requirements: [{ kind: 'agent', count: 1 }]
      }
    });
    const body = rulesJsonToPolicyBody(rulesJson);
    expect(body).not.toBeNull();
    if (!body) return;
    expect(body.blocks).toEqual({
      claim_material: { agents: 2, AND_humans: 1 }
    });
    expect(body.fallback).toEqual({ agents: 1 });

    // Sanity-check: the scorer consumes the produced body without error.
    const claims: ValidationClaimPointer[] = [
      {
        id: 'c1',
        kind: 'claim_material',
        text: 'A material claim.',
        source: { tool: 'doc', pointer: 'doc:p1', url: '/x' },
        checks: []
      }
    ];
    const score = scoreValidationClaims(body, claims);
    expect(score.totalClaims).toBe(1);
    expect(score.claimResults[0].id).toBe('c1');

    // Sanity-check: the orchestrator consumes the produced body without
    // error and produces a route plan for the claim.
    const plan = planValidationOrchestration({
      policy: body,
      claims,
      participants: []
    });
    expect(plan.summary.totalClaims).toBe(1);
    expect(plan.claimPlans).toHaveLength(1);
  });

  it('lowers a waiver-only lens to a body that creates no requirements', () => {
    const rulesJson = JSON.stringify({
      blocks: {
        opinion: { mode: 'none', reason: 'waived' }
      }
    });
    const body = rulesJsonToPolicyBody(rulesJson);
    expect(body).toEqual({ blocks: { opinion: {} } });
  });
});
