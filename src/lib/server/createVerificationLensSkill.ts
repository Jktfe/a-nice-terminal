/**
 * createVerificationLensSkill — Phase B2 substrate scaffold.
 *
 * Entry function for the /create-verification-lens skill. Takes a
 * SkillInput (validated requirements + scope + author identity),
 * constructs the LLM prompt per docs/specs/create-verification-lens-
 * prompt-template.md, calls the model via the injected callModel
 * function, then parses + validates the response against the
 * substrate contract from B1 (docs/specs/create-verification-lens-
 * skill.md).
 *
 * The actual model invocation (model selection, API key wiring, cost
 * tracking, retry logic) lives in B3. This module ships the
 * substrate-shaped pieces:
 *   - typed input/output/refusal shapes
 *   - prompt construction (system + user messages)
 *   - response parser with structured refusal on each invariant
 *     failure
 *   - skill entry function accepting an injected callModel
 *
 * Caller wires their own callModel implementation (Anthropic SDK,
 * Bedrock, etc) and passes it as a parameter. Tests use a stub.
 */

import { listSourceSets } from './sourceSetsStore';
import { listTaxonomy } from './verificationTaxonomyStore';
import type { TagDefinition, TagProvenance } from './verificationTaxonomyStore';
import type { SourceSet } from './sourceSetsStore';
import type {
  LensTagDisputePolicy,
  LensTagExpectation
} from './lensTagRowsStore';

// ───────────────────────── types ─────────────────────────

export type AuthorKind = 'human' | 'agent' | 'system';
export type SourceSetMemberKind =
  | 'domain' | 'url' | 'repo' | 'file_collection'
  | 'named_person' | 'database' | 'named_document_set';
export type LensKind =
  | 'poc' | 'fca' | 'investment_memo' | 'scientific_claim'
  | 'marketing_copy' | 'custom';
export type SkillErrorKind =
  | 'out_of_substrate_scope'
  | 'no_source_sets_available'
  | 'org_admin_required'
  | 'cost_cap_exceeded'
  | 'requirements_too_vague'
  | 'parse_error'
  | 'invalid_shape'
  | 'invalid_lens'
  | 'unknown_tag'
  | 'invalid_enum'
  | 'unknown_source_set'
  | 'invalid_refusal';

export interface SkillInput {
  requirements: string;
  lens_name: string;
  scope_id: string;
  framework_hint?: string;
  author_handle: string;
  author_kind: AuthorKind;
  bound_source_set_ids?: string[];
  dry_run?: boolean;
}

export interface SkillSuccessOutput {
  kind: 'lens';
  lens: {
    name: string;
    description: string;
    lens_kind: LensKind;
    minimum_pass_record_age_ms: number | null;
    re_verification_on_content_change: boolean;
    out_of_scope_tags_json: string;
  };
  tag_rows: Array<{
    tag_id: string;
    tag_version: number | null;
    expectation: LensTagExpectation;
    min_verifier_count: number;
    verifier_mix: string[];
    dispute_policy: LensTagDisputePolicy;
    weight: number;
    notes: string;
  }>;
  source_set_bindings: string[];
  suggested_source_sets: Array<{
    proposed_name: string;
    proposed_members: Array<{
      member_kind: SourceSetMemberKind;
      member_value: string;
      rationale: string;
    }>;
  }>;
}

export interface SkillRefusalOutput {
  kind: 'refusal';
  error_kind: SkillErrorKind;
  reason: string;
  suggested_action: string;
  substrate_scope_hint?: string;
}

export type SkillOutput = SkillSuccessOutput | SkillRefusalOutput;

/** Model invocation interface. Caller wires the actual API. */
export interface CallModelInput {
  systemMessage: string;
  userMessage: string;
}
export type CallModel = (input: CallModelInput) => Promise<string>;

// ───────────────────────── input validation ─────────────────────────

function validateInput(input: SkillInput): SkillRefusalOutput | null {
  const reqLen = (input.requirements ?? '').trim().length;
  if (reqLen < 50 || reqLen > 4000) {
    return {
      kind: 'refusal',
      error_kind: 'requirements_too_vague',
      reason: `requirements must be 50-4000 chars; got ${reqLen}`,
      suggested_action: 'Describe what you want verified in 50+ characters; cap at 4000.'
    };
  }
  const nameLen = (input.lens_name ?? '').trim().length;
  if (nameLen < 3 || nameLen > 80 || !/^[a-zA-Z0-9 _-]+$/.test(input.lens_name)) {
    return {
      kind: 'refusal',
      error_kind: 'invalid_lens',
      reason: `lens_name must be 3-80 chars, alphanumeric/space/_/- only`,
      suggested_action: 'Pick a clear short name (e.g. "FCA PE financial promotions").'
    };
  }
  if (input.framework_hint && (input.framework_hint.length > 64 || input.framework_hint.includes('/'))) {
    return {
      kind: 'refusal',
      error_kind: 'invalid_lens',
      reason: 'framework_hint must be ≤64 chars and slash-free',
      suggested_action: 'Use a short framework name (FCA / SEC / ESMA / internal).'
    };
  }
  return null;
}

// ───────────────────────── prompt construction ─────────────────────────

export const SYSTEM_MESSAGE = `You are the ANT verification-lens authoring skill. You translate a user's plain-English description of what they want verified into a concrete LENS SPEC that ANT's verification substrate can execute.

## Substrate scope

You ONLY produce lenses for: claim attribution, source-context, link checking, direct-quote integrity, multi-verifier consensus / dispute resolution.

You DO NOT produce lenses for: code correctness, content moderation, sentiment analysis, image / video classification, free-form open-web fact-checking without source-set binding.

If the user's requirements are out of substrate scope, REFUSE with error_kind='out_of_substrate_scope'. Do NOT ship a near-empty or closest-fit lens.

## Authoring rules

1. ONLY bind tag ids from the catalog in the user message.
2. Expectations: required / forbidden / consensus-required / heuristic-allowed / out-of-scope.
3. Dispute policies: majority (default) / unanimous / any-pass / any-fail / escalate.
4. Source-sets: bind existing by id; surface needed-but-missing in suggested_source_sets[] with proposed_name, proposed_members[] (member_kind + member_value + rationale per member). NEVER auto-create.
5. Weights: default 1.0; primary 2.0; reputable 1.5. Use sparingly.
6. Temporal rules: re_verification_on_content_change=true for source-grounded lenses; minimum_pass_record_age_ms for "established/ratified/decided" claims; out_of_scope_tags_json includes process.flagged-ignorable.
7. lens_kind: poc / fca / investment_memo / scientific_claim / marketing_copy / custom.

## Output

Return a SINGLE JSON object — no markdown fences, no preamble. Either:

SUCCESS shape:
{
  "kind": "lens",
  "lens": { name, description, lens_kind, minimum_pass_record_age_ms, re_verification_on_content_change, out_of_scope_tags_json },
  "tag_rows": [{ tag_id, tag_version, expectation, min_verifier_count, verifier_mix, dispute_policy, weight, notes }],
  "source_set_bindings": [<existing source_set ids>],
  "suggested_source_sets": [{ proposed_name, proposed_members: [{ member_kind, member_value, rationale }] }]
}

REFUSAL shape:
{
  "kind": "refusal",
  "error_kind": "out_of_substrate_scope" | "no_source_sets_available" | "org_admin_required" | "cost_cap_exceeded" | "requirements_too_vague",
  "reason": "<1-2 sentences>",
  "suggested_action": "<concrete next step>",
  "substrate_scope_hint": "<only for out_of_substrate_scope>"
}

Constraints: tag_id MUST be in the catalog; verifier_mix MUST be generic placeholders (@human-reviewer, @agent-verifier) or caller-supplied; relational tags use family root id (source.supports-claim, source.refutes-claim) not parameterised form.`;

export function buildUserMessage(
  input: SkillInput,
  tagsCatalog: TagDefinition[],
  availableSourceSets: SourceSet[]
): string {
  const tagsCatalogJson = JSON.stringify(
    tagsCatalog.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      protocolResolver: t.protocolResolver,
      isRelational: t.isRelational,
      familyRoot: t.familyRoot
    })),
    null,
    2
  );
  const sourceSetsJson = JSON.stringify(
    availableSourceSets.map((s) => ({ id: s.id, name: s.name, scope_kind: s.scopeKind })),
    null,
    2
  );
  return `## Authoring request

Author a verification lens to match these requirements:

${input.requirements.trim()}

## Framework hint

${input.framework_hint ?? 'none specified — choose lens_kind based on requirements'}

## Lens metadata

- name: ${input.lens_name}
- scope_id: ${input.scope_id}
- author: ${input.author_handle} (${input.author_kind})
- bound_source_set_ids (existing): ${(input.bound_source_set_ids ?? []).join(', ') || 'none'}

## Available tags catalog (active only, scope-filtered)

${tagsCatalogJson}

## Available source-sets for this scope

${sourceSetsJson}

## Your task

Produce a single JSON object matching the lens-spec contract. If requirements are out of substrate scope, refuse with error_kind.

Output:`;
}

// ───────────────────────── response parser ─────────────────────────

const VALID_EXPECTATIONS = new Set<LensTagExpectation>([
  'required', 'forbidden', 'consensus-required', 'heuristic-allowed', 'out-of-scope'
]);
const VALID_DISPUTE_POLICIES = new Set<LensTagDisputePolicy>([
  'majority', 'unanimous', 'any-pass', 'any-fail', 'escalate'
]);
const VALID_LENS_KINDS = new Set<LensKind>([
  'poc', 'fca', 'investment_memo', 'scientific_claim', 'marketing_copy', 'custom'
]);
const VALID_MEMBER_KINDS = new Set<SourceSetMemberKind>([
  'domain', 'url', 'repo', 'file_collection', 'named_person', 'database', 'named_document_set'
]);
const VALID_REFUSAL_KINDS = new Set<SkillErrorKind>([
  'out_of_substrate_scope', 'no_source_sets_available', 'org_admin_required',
  'cost_cap_exceeded', 'requirements_too_vague'
]);

function refusal(
  errorKind: SkillErrorKind,
  reason: string,
  suggestedAction: string = 'Re-run the skill with corrected input.'
): SkillRefusalOutput {
  return { kind: 'refusal', error_kind: errorKind, reason, suggested_action: suggestedAction };
}

/**
 * Parse + validate an LLM response string against the substrate
 * contract. Returns either a fully-validated SkillOutput or a
 * structured refusal naming the failure mode.
 *
 * The parser is the substrate's defence against malformed LLM output
 * — every invariant in B1 is enforced here so persistence-layer code
 * can trust the typed object.
 */
export function parseSkillResponse(
  raw: string,
  tagsCatalog: TagDefinition[],
  availableSourceSetIds: Set<string>
): SkillOutput {
  let parsed: unknown;
  try {
    // Tolerate markdown fences if the model wrapped them despite the prompt.
    const cleaned = raw.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch (cause) {
    return refusal('parse_error',
      `LLM returned non-JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      'Re-run the skill; if it persists, the prompt may need tightening.');
  }

  if (!parsed || typeof parsed !== 'object') {
    return refusal('invalid_shape', 'LLM output is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.kind === 'refusal') {
    if (typeof obj.error_kind !== 'string' || !VALID_REFUSAL_KINDS.has(obj.error_kind as SkillErrorKind)) {
      return refusal('invalid_refusal', `error_kind invalid: ${obj.error_kind}`);
    }
    if (typeof obj.reason !== 'string' || obj.reason.trim().length === 0) {
      return refusal('invalid_refusal', 'refusal.reason must be non-empty string');
    }
    return {
      kind: 'refusal',
      error_kind: obj.error_kind as SkillErrorKind,
      reason: obj.reason,
      suggested_action: typeof obj.suggested_action === 'string' ? obj.suggested_action : '',
      substrate_scope_hint: typeof obj.substrate_scope_hint === 'string' ? obj.substrate_scope_hint : undefined
    };
  }
  if (obj.kind !== 'lens') {
    return refusal('invalid_shape', `kind must be 'lens' or 'refusal'; got ${obj.kind}`);
  }

  const lens = obj.lens as Record<string, unknown> | undefined;
  if (!lens || typeof lens !== 'object') {
    return refusal('invalid_lens', 'lens block missing or not an object');
  }
  if (typeof lens.name !== 'string' || lens.name.length < 3 || lens.name.length > 80
      || /[<>{}]/.test(lens.name)) {
    return refusal('invalid_lens', `lens.name invalid (3-80 chars, no <>{}): ${lens.name}`);
  }
  if (typeof lens.description !== 'string' || lens.description.trim().length === 0) {
    return refusal('invalid_lens', 'lens.description must be non-empty');
  }
  if (typeof lens.lens_kind !== 'string' || !VALID_LENS_KINDS.has(lens.lens_kind as LensKind)) {
    return refusal('invalid_enum', `lens_kind invalid: ${lens.lens_kind}`);
  }
  // re_verification_on_content_change: tolerate boolean OR 0/1 number
  const reVerify = lens.re_verification_on_content_change;
  if (typeof reVerify !== 'boolean' && reVerify !== 0 && reVerify !== 1) {
    return refusal('invalid_lens', 're_verification_on_content_change must be boolean');
  }

  const tagCatalogIds = new Set(tagsCatalog.map((t) => t.id));
  const rows = obj.tag_rows;
  if (!Array.isArray(rows)) {
    return refusal('invalid_shape', 'tag_rows must be an array');
  }
  const parsedRows: SkillSuccessOutput['tag_rows'] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    if (!r || typeof r !== 'object') {
      return refusal('invalid_shape', `tag_rows[${i}] is not an object`);
    }
    if (typeof r.tag_id !== 'string' || !tagCatalogIds.has(r.tag_id)) {
      return refusal('unknown_tag', `tag_rows[${i}].tag_id="${r.tag_id}" is not in the catalog`);
    }
    if (typeof r.expectation !== 'string' || !VALID_EXPECTATIONS.has(r.expectation as LensTagExpectation)) {
      return refusal('invalid_enum', `tag_rows[${i}].expectation invalid: ${r.expectation}`);
    }
    const dispute = r.dispute_policy ?? 'majority';
    if (typeof dispute !== 'string' || !VALID_DISPUTE_POLICIES.has(dispute as LensTagDisputePolicy)) {
      return refusal('invalid_enum', `tag_rows[${i}].dispute_policy invalid: ${dispute}`);
    }
    parsedRows.push({
      tag_id: r.tag_id,
      tag_version: typeof r.tag_version === 'number' ? r.tag_version : null,
      expectation: r.expectation as LensTagExpectation,
      min_verifier_count: typeof r.min_verifier_count === 'number' && r.min_verifier_count > 0
        ? Math.floor(r.min_verifier_count) : 1,
      verifier_mix: Array.isArray(r.verifier_mix) ? r.verifier_mix.filter((v): v is string => typeof v === 'string') : [],
      dispute_policy: dispute as LensTagDisputePolicy,
      weight: typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : 1.0,
      notes: typeof r.notes === 'string' ? r.notes : ''
    });
  }

  const bindings = obj.source_set_bindings;
  if (!Array.isArray(bindings)) {
    return refusal('invalid_shape', 'source_set_bindings must be an array');
  }
  const parsedBindings: string[] = [];
  for (const b of bindings) {
    if (typeof b !== 'string') {
      return refusal('invalid_shape', 'source_set_bindings[i] must be string');
    }
    if (!availableSourceSetIds.has(b)) {
      return refusal('unknown_source_set', `source_set ${b} is not in the available set for this scope`);
    }
    parsedBindings.push(b);
  }

  const suggested = obj.suggested_source_sets;
  const parsedSuggested: SkillSuccessOutput['suggested_source_sets'] = [];
  if (Array.isArray(suggested)) {
    for (let i = 0; i < suggested.length; i++) {
      const s = suggested[i] as Record<string, unknown>;
      if (!s || typeof s !== 'object' || typeof s.proposed_name !== 'string') {
        return refusal('invalid_shape', `suggested_source_sets[${i}] invalid`);
      }
      const members = Array.isArray(s.proposed_members) ? s.proposed_members : [];
      const parsedMembers: SkillSuccessOutput['suggested_source_sets'][number]['proposed_members'] = [];
      for (const m of members) {
        const mm = m as Record<string, unknown>;
        if (!mm || typeof mm !== 'object'
            || typeof mm.member_kind !== 'string' || !VALID_MEMBER_KINDS.has(mm.member_kind as SourceSetMemberKind)
            || typeof mm.member_value !== 'string'
            || typeof mm.rationale !== 'string') {
          return refusal('invalid_shape', `suggested_source_sets[${i}].proposed_members[i] invalid`);
        }
        parsedMembers.push({
          member_kind: mm.member_kind as SourceSetMemberKind,
          member_value: mm.member_value,
          rationale: mm.rationale
        });
      }
      parsedSuggested.push({ proposed_name: s.proposed_name, proposed_members: parsedMembers });
    }
  }

  return {
    kind: 'lens',
    lens: {
      name: lens.name,
      description: lens.description,
      lens_kind: lens.lens_kind as LensKind,
      minimum_pass_record_age_ms: typeof lens.minimum_pass_record_age_ms === 'number'
        ? lens.minimum_pass_record_age_ms : null,
      re_verification_on_content_change: reVerify === true || reVerify === 1,
      out_of_scope_tags_json: typeof lens.out_of_scope_tags_json === 'string'
        ? lens.out_of_scope_tags_json : '[]'
    },
    tag_rows: parsedRows,
    source_set_bindings: parsedBindings,
    suggested_source_sets: parsedSuggested
  };
}

// ───────────────────────── entry ─────────────────────────

/**
 * Run the create-verification-lens skill end-to-end. The substrate
 * does:
 *
 *   1. Validate input (length + character class).
 *   2. Fetch the scope-filtered tags catalog + available source-sets
 *      from the substrate stores.
 *   3. Build system + user messages per the prompt template.
 *   4. Call the injected callModel with both messages.
 *   5. Parse + validate the response into a typed SkillOutput.
 *
 * The caller wires the actual model call (Anthropic SDK, Bedrock,
 * etc) via the callModel parameter. Tests inject a stub. The
 * skill_invocations audit row is written by the API endpoint that
 * wraps this function — B3 ships that endpoint with cost cap +
 * org-admin gate.
 */
export async function runCreateVerificationLensSkill(
  input: SkillInput,
  callModel: CallModel
): Promise<SkillOutput> {
  const inputFailure = validateInput(input);
  if (inputFailure) return inputFailure;

  // Q1 (ratified a): active + org-scope tags, system+global union org+scopeId
  const systemTags = listTaxonomy({
    provenance: 'system',
    scopeId: 'global',
    lifecycleStates: ['active'],
    latestVersionOnly: true
  });
  const orgTags = listTaxonomy({
    provenance: 'org' as TagProvenance,
    scopeId: input.scope_id,
    lifecycleStates: ['active'],
    latestVersionOnly: true
  });
  const tagsCatalog = [...systemTags, ...orgTags];

  // Available source-sets for the scope (existing only; missing get
  // surfaced in suggested_source_sets per Q2 ratification)
  const availableSourceSets = listSourceSets({
    ownerOrg: input.scope_id,
    lifecycleStates: ['active']
  });
  const availableSourceSetIds = new Set(availableSourceSets.map((s) => s.id));

  // If the org has zero source-sets AND the framework hint suggests
  // external sources will be needed, return early with the explicit
  // refusal (don't burn a model call to produce something the caller
  // will need to re-bind anyway).
  if (availableSourceSets.length === 0 && input.framework_hint
      && /fca|sec|esma|mifid|gdpr/i.test(input.framework_hint)) {
    return refusal(
      'no_source_sets_available',
      `framework_hint "${input.framework_hint}" suggests this lens needs an external source-set, but no source-sets exist for scope ${input.scope_id}.`,
      `Run \`ant source-set create --scope ${input.scope_id}\` to add the source-set this framework expects, then re-run the skill.`
    );
  }

  const userMessage = buildUserMessage(input, tagsCatalog, availableSourceSets);
  let raw: string;
  try {
    raw = await callModel({ systemMessage: SYSTEM_MESSAGE, userMessage });
  } catch (cause) {
    return refusal(
      'parse_error',
      `callModel failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      'Check model wiring + retry.'
    );
  }
  return parseSkillResponse(raw, tagsCatalog, availableSourceSetIds);
}
