import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildUserMessage,
  parseSkillResponse,
  runCreateVerificationLensSkill,
  SYSTEM_MESSAGE
} from './createVerificationLensSkill';
import type { CallModel, SkillInput, SkillOutput } from './createVerificationLensSkill';
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

describe('input validation', () => {
  it('refuses requirements shorter than 50 chars', async () => {
    const stub: CallModel = vi.fn();
    const out = await runCreateVerificationLensSkill(
      { ...SAMPLE_INPUT, requirements: 'too short' }, stub);
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') expect(out.error_kind).toBe('requirements_too_vague');
    expect(stub).not.toHaveBeenCalled();
  });

  it('refuses lens_name with HTML-injection chars', async () => {
    const stub: CallModel = vi.fn();
    const out = await runCreateVerificationLensSkill(
      { ...SAMPLE_INPUT, lens_name: 'bad<script>' }, stub);
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') expect(out.error_kind).toBe('invalid_lens');
    expect(stub).not.toHaveBeenCalled();
  });

  it('refuses oversized framework_hint', async () => {
    const stub: CallModel = vi.fn();
    const out = await runCreateVerificationLensSkill(
      { ...SAMPLE_INPUT, framework_hint: 'x'.repeat(100) }, stub);
    expect(out.kind).toBe('refusal');
  });
});

// ───────────────────────── ratified-spec compliance ─────────────────────────

describe('Q2 ratified: refuses early when framework needs sources but org has none', () => {
  it('FCA framework_hint + zero source-sets → no_source_sets_available without model call', async () => {
    seedSystemTagSet();
    const stub: CallModel = vi.fn();
    const out = await runCreateVerificationLensSkill(
      { ...SAMPLE_INPUT, framework_hint: 'FCA' }, stub);
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') expect(out.error_kind).toBe('no_source_sets_available');
    // No model call burned on a known-no-go input
    expect(stub).not.toHaveBeenCalled();
  });

  it('internal framework hint + zero source-sets → still calls model (only regulated frameworks short-circuit)', async () => {
    seedSystemTagSet();
    const fakeOutput = JSON.stringify({
      kind: 'lens',
      lens: {
        name: 'Internal QC',
        description: 'Quality control lens',
        lens_kind: 'custom',
        minimum_pass_record_age_ms: null,
        re_verification_on_content_change: false,
        out_of_scope_tags_json: '[]'
      },
      tag_rows: [],
      source_set_bindings: [],
      suggested_source_sets: []
    });
    const stub: CallModel = vi.fn().mockResolvedValue(fakeOutput);
    const out = await runCreateVerificationLensSkill(
      { ...SAMPLE_INPUT, framework_hint: 'internal' }, stub);
    expect(out.kind).toBe('lens');
    expect(stub).toHaveBeenCalledOnce();
  });
});

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

describe('runCreateVerificationLensSkill — end to end', () => {
  it('routes through the stub callModel and returns parsed output', async () => {
    seedSystemTagSet();
    createSourceSet({
      name: 'Acme primary sources', ownerOrg: 'acme', createdBy: '@admin'
    });
    const fakeOutput: SkillOutput = {
      kind: 'lens',
      lens: {
        name: 'Acme investor lens',
        description: 'Verifies investor letter claims',
        lens_kind: 'investment_memo',
        minimum_pass_record_age_ms: null,
        re_verification_on_content_change: true,
        out_of_scope_tags_json: '[]'
      },
      tag_rows: [{
        tag_id: 'claim.factual',
        tag_version: null,
        expectation: 'required',
        min_verifier_count: 2,
        verifier_mix: ['@human-reviewer', '@agent-verifier'],
        dispute_policy: 'unanimous',
        weight: 1.0,
        notes: 'every factual claim needs source'
      }],
      source_set_bindings: [],
      suggested_source_sets: []
    };
    const stub: CallModel = vi.fn().mockResolvedValue(JSON.stringify(fakeOutput));
    const out = await runCreateVerificationLensSkill(
      { ...SAMPLE_INPUT, framework_hint: 'internal' }, stub);
    expect(out.kind).toBe('lens');
    if (out.kind === 'lens') {
      expect(out.lens.name).toBe('Acme investor lens');
      expect(out.tag_rows).toHaveLength(1);
    }
    // Verify stub was called with the right shape
    const call = (stub as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.systemMessage).toContain('out_of_substrate_scope');
    expect(call.userMessage).toContain(SAMPLE_INPUT.requirements);
  });

  it('surfaces callModel errors as parse_error refusal (substrate stays honest)', async () => {
    seedSystemTagSet();
    const stub: CallModel = vi.fn().mockRejectedValue(new Error('network down'));
    const out = await runCreateVerificationLensSkill(
      { ...SAMPLE_INPUT, framework_hint: 'internal' }, stub);
    expect(out.kind).toBe('refusal');
    if (out.kind === 'refusal') {
      expect(out.error_kind).toBe('parse_error');
      expect(out.reason).toContain('network down');
    }
  });
});
