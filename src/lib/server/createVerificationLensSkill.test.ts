import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildUserMessage,
  parseSkillResponse,
  SYSTEM_MESSAGE
} from './createVerificationLensSkill';
import type { SkillInput } from './createVerificationLensSkill';
import { createTag, listTaxonomy, resetVerificationTaxonomyStoreForTests } from './verificationTaxonomyStore';
import { createSourceSet, resetSourceSetsStoreForTests } from './sourceSetsStore';
import { getIdentityDb } from './db';

const SAMPLE_INPUT: SkillInput = {
  requirements:
    'We publish quarterly investor letters and need to catch unsupported performance claims plus forward-looking statements that lack proper hedging language. Every factual claim about returns needs an attached primary source.',
  lens_name: 'Quarterly investor letter',
  scope_id: 'acme',
  framework_hint: 'internal',
  author_handle: '@compliance',
  author_kind: 'human'
};

function seedSystemTagSet(): void {
  const baseDefs: Array<[string, string, string]> = [
    ['claim.factual', 'Factual claim', 'claim'],
    ['source.primary', 'Primary source', 'source'],
    ['source.supports-claim', 'Supports claim', 'source'],
    ['source.refutes-claim', 'Refutes claim', 'source'],
    ['content.direct-quote', 'Direct quote', 'content'],
    ['process.flagged-ignorable', 'Flagged ignorable', 'process']
  ];
  for (const [id, name, category] of baseDefs) {
    createTag({
      id, name, description: `seed ${id}`, category,
      provenance: 'system', scopeId: 'global',
      protocolResolver: { kind: 'static', protocol: 'heuristic' },
      isRelational: id.includes('supports-claim') || id.includes('refutes-claim'),
      familyRoot: null, isHumanEditable: true,
      createdBy: '@system', actorKind: 'system',
      initialLifecycleState: 'active'
    });
  }
}

beforeEach(() => {
  resetVerificationTaxonomyStoreForTests();
  resetSourceSetsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

afterEach(() => {
  resetVerificationTaxonomyStoreForTests();
  resetSourceSetsStoreForTests();
  getIdentityDb().prepare('DELETE FROM verification_lenses').run();
});

// ───────────────────────── input validation ─────────────────────────


// ───────────────────────── ratified-spec compliance ─────────────────────────


// ───────────────────────── parser ─────────────────────────

describe('parseSkillResponse — success path', () => {
  it('parses a valid lens output with all sections', () => {
    seedSystemTagSet();
    const raw = JSON.stringify({
      kind: 'lens',
      lens: {
        name: 'Test lens',
        description: 'Verifies claims in quarterly letters',
        lens_kind: 'investment_memo',
        minimum_pass_record_age_ms: 86400000,
        re_verification_on_content_change: true,
        out_of_scope_tags_json: '["process.flagged-ignorable"]'
      },
      tag_rows: [
        {
          tag_id: 'claim.factual',
          expectation: 'required',
          min_verifier_count: 2,
          verifier_mix: ['@human-reviewer', '@agent-verifier'],
          dispute_policy: 'unanimous',
          weight: 1.0,
          notes: 'Every factual claim needs source.'
        }
      ],
      source_set_bindings: [],
      suggested_source_sets: []
    });
    const tagsCatalog = listTaxonomy({
      lifecycleStates: ['active'], latestVersionOnly: true
    });
    const out = parseSkillResponse(raw, tagsCatalog, new Set());
    expect(out.kind).toBe('lens');
    if (out.kind === 'lens') {
      expect(out.lens.name).toBe('Test lens');
      expect(out.tag_rows).toHaveLength(1);
      expect(out.tag_rows[0].dispute_policy).toBe('unanimous');
    }
  });

  it('tolerates markdown fence wrapping (some models add them despite the prompt)', () => {
    seedSystemTagSet();
    const raw = '```json\n' + JSON.stringify({
      kind: 'lens',
      lens: {
        name: 'Test', description: 'd', lens_kind: 'custom',
        minimum_pass_record_age_ms: null, re_verification_on_content_change: false,
        out_of_scope_tags_json: '[]'
      },
      tag_rows: [], source_set_bindings: [], suggested_source_sets: []
    }) + '\n```';
    const tagsCatalog = listTaxonomy({
      lifecycleStates: ['active'], latestVersionOnly: true
    });
    const out = parseSkillResponse(raw, tagsCatalog, new Set());
    expect(out.kind).toBe('lens');
  });
});

describe('parseSkillResponse — refusal paths', () => {
  it('refuses non-JSON with parse_error', () => {
    const out = parseSkillResponse('not json at all', [], new Set());
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') expect(out.error_kind).toBe('parse_error');
  });

  it('refuses unknown tag_id with unknown_tag + offending id in reason', () => {
    seedSystemTagSet();
    const tagsCatalog = listTaxonomy({
      lifecycleStates: ['active'], latestVersionOnly: true
    });
    const raw = JSON.stringify({
      kind: 'lens',
      lens: { name: 'TestX', description: 'desc', lens_kind: 'custom',
              minimum_pass_record_age_ms: null,
              re_verification_on_content_change: false,
              out_of_scope_tags_json: '[]' },
      tag_rows: [{ tag_id: 'org.fabricated.not-in-catalog',
                   expectation: 'required', dispute_policy: 'majority',
                   min_verifier_count: 1, verifier_mix: [],
                   weight: 1.0, notes: 'invented' }],
      source_set_bindings: [], suggested_source_sets: []
    });
    const out = parseSkillResponse(raw, tagsCatalog, new Set());
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') {
      expect(out.error_kind).toBe('unknown_tag');
      expect(out.reason).toContain('org.fabricated.not-in-catalog');
    }
  });

  it('refuses invalid expectation enum', () => {
    seedSystemTagSet();
    const tagsCatalog = listTaxonomy({
      lifecycleStates: ['active'], latestVersionOnly: true
    });
    const raw = JSON.stringify({
      kind: 'lens',
      lens: { name: 'TestX', description: 'desc', lens_kind: 'custom',
              minimum_pass_record_age_ms: null,
              re_verification_on_content_change: false,
              out_of_scope_tags_json: '[]' },
      tag_rows: [{ tag_id: 'claim.factual', expectation: 'made-up-enum',
                   dispute_policy: 'majority', min_verifier_count: 1,
                   verifier_mix: [], weight: 1.0, notes: '' }],
      source_set_bindings: [], suggested_source_sets: []
    });
    const out = parseSkillResponse(raw, tagsCatalog, new Set());
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') expect(out.error_kind).toBe('invalid_enum');
  });

  it('refuses unknown source-set binding', () => {
    seedSystemTagSet();
    const tagsCatalog = listTaxonomy({
      lifecycleStates: ['active'], latestVersionOnly: true
    });
    const raw = JSON.stringify({
      kind: 'lens',
      lens: { name: 'TestX', description: 'desc', lens_kind: 'custom',
              minimum_pass_record_age_ms: null,
              re_verification_on_content_change: false,
              out_of_scope_tags_json: '[]' },
      tag_rows: [], source_set_bindings: ['nonexistent-set'],
      suggested_source_sets: []
    });
    const out = parseSkillResponse(raw, tagsCatalog, new Set());
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') expect(out.error_kind).toBe('unknown_source_set');
  });

  it('passes through a valid refusal from the model', () => {
    const raw = JSON.stringify({
      kind: 'refusal',
      error_kind: 'out_of_substrate_scope',
      reason: 'Caller asked for code linting; not verification substrate.',
      suggested_action: 'Use a code linter instead.',
      substrate_scope_hint: 'Verification covers claims + sources + links + quotes.'
    });
    const out = parseSkillResponse(raw, [], new Set());
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') {
      expect(out.error_kind).toBe('out_of_substrate_scope');
      expect(out.substrate_scope_hint).toContain('claims');
    }
  });

  it('refuses refusal with invalid error_kind', () => {
    const raw = JSON.stringify({
      kind: 'refusal',
      error_kind: 'invented_error',
      reason: 'bad'
    });
    const out = parseSkillResponse(raw, [], new Set());
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') expect(out.error_kind).toBe('invalid_refusal');
  });
});

// ───────────────────────── prompt construction ─────────────────────────

describe('prompt construction', () => {
  it('SYSTEM_MESSAGE includes substrate scope + refusal rule', () => {
    expect(SYSTEM_MESSAGE).toContain('claim attribution');
    expect(SYSTEM_MESSAGE).toContain('out_of_substrate_scope');
    expect(SYSTEM_MESSAGE).toContain('NEVER auto-create');
  });

  it('buildUserMessage includes the requirements, framework hint, scope_id, and catalog JSON', () => {
    const msg = buildUserMessage(
      SAMPLE_INPUT,
      [],
      []
    );
    expect(msg).toContain(SAMPLE_INPUT.requirements);
    expect(msg).toContain('scope_id: acme');
    expect(msg).toContain('internal');
    expect(msg).toContain('[]'); // empty tags catalog
  });
});

// ───────────────────────── end-to-end with stub model ─────────────────────────

