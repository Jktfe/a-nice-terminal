# `/create-verification-lens` Skill Spec — Phase B1 (RATIFIED)

**Status**: RATIFIED. JWPK eiw05zdurz msg_s1q1otis70 2026-05-28 picked Q1=a, Q2=b, Q3=a (recommendations accepted). All sections concrete; B2 prompt template can start.

**Owner**: @speedyclaude (Phase A substrate implementer)
**Consumer surface**: Mac antchat M10 (Lens designer) + iOS antios D3 (Author wizard) + web `/verification/lenses/new` (fallback).
**Substrate dependencies (all SHIPPED)**:
- Slice 1: `verification_taxonomy` + tag definitions
- Slice 2: `source_sets` + members
- Slice 5: `verification_lenses` + `lens_tag_rows`
- Slice 7b: `POST /api/tags`, `POST /api/verification/lenses`, `POST /api/verification/lenses/[lensId]/tag-rows`

---

## Why the skill exists

Per JWPK direction during the 17-question ratification round
(`mem_research_verification_classification_2026_05_28.md` Q on FCA/ONS
seeds): ANT should NOT ship canned regulatory lenses. Each org's
"FCA financial promotion lens" is different in practice — internal
materiality thresholds, dispute escalation, evidence requirements vary.

The skill replaces the canned seeds. Users provide a **plain-English
description** of what they want verified (e.g. "We're a PE firm doing
quarterly investor letters; we need to catch unsupported performance
claims and forward-looking statements without proper hedges"). The
skill emits a concrete **lens spec** as JSON ready to POST against
`/api/verification/lenses` + the matching `lens_tag_rows` entries.

The skill is per-org-scoped: every invocation logs the caller identity
+ the input requirements + the output lens id. That audit trail is
the substrate the "premium-tier author actions" gating in F2 sits on.

---

## Input contract

```typescript
interface SkillInput {
  /** Free-form plain-English description of what the lens should verify.
   *  Must NOT contain executable code, secrets, or directly-quoted policy
   *  text the caller doesn't own. */
  requirements: string;          // 50-4000 chars
  /** Human-readable name for the lens. Becomes verification_lenses.name. */
  lens_name: string;             // 3-80 chars
  /** Scope this lens lives in. Mirrors verification_lenses.scope_id.
   *  Default 'global' for system tier; org-id for paying tiers. */
  scope_id: string;
  /** Optional regulatory framework hint to bias the generation
   *  (FCA / SEC / ESMA / MiFID2 / GDPR / internal). Free-form; the
   *  skill uses it to colour the prompt + select source-set affinities. */
  framework_hint?: string;
  /** Caller identity — recorded in the audit log + used as
   *  verification_lenses.created_by. */
  author_handle: string;
  author_kind: 'human' | 'agent' | 'system';
  /** Optional pre-existing source-set ids the lens should bind to.
   *  Skill MAY suggest new source-sets but cannot create them
   *  silently — separate `ant source-set create` flow required. */
  bound_source_set_ids?: string[];
}
```

### Input validation (server-enforced before LLM call)

- `requirements` length within 50-4000 chars (rejects empty + DoS shapes)
- `lens_name` matches `/^[a-zA-Z0-9 _-]+$/` (no markdown/HTML injection
  surface; this becomes a stored display string)
- `scope_id` must match an org/user the caller's identity can author
  for (server-authoritative authz; `requireOrgAdminAuth(scope_id)`)
- `framework_hint` if present capped at 64 chars + slash-free (no
  prompt-injection vectors via the hint field)

---

## Output contract

The skill returns a lens-spec object ready for HTTP submission. The
shape mirrors the substrate tables 1-to-1 so callers can POST sections
independently if they want to review before commit.

```typescript
interface SkillOutput {
  /** Server-allocated when the skill writes via the API; null if the
   *  caller is in "review mode" (dry-run). */
  lens_id: string | null;
  /** verification_lenses row shape — ready for POST /api/verification/lenses */
  lens: {
    name: string;
    description: string;        // Human-readable summary of what
                                // this lens verifies + when it
                                // applies. Generated from requirements.
    lens_kind: 'poc' | 'fca' | 'investment_memo' | 'scientific_claim'
              | 'marketing_copy' | 'custom';
    scope: 'org' | 'user' | 'public';
    scope_id: string;
    minimum_pass_record_age_ms: number | null;
    re_verification_on_content_change: boolean;
    out_of_scope_tags_json: string;  // JSON-encoded array of tag ids
  };
  /** lens_tag_rows entries — ready for POST .../tag-rows per row */
  tag_rows: Array<{
    tag_id: string;
    tag_version: number | null;
    expectation: 'required' | 'forbidden' | 'consensus-required'
               | 'heuristic-allowed' | 'out-of-scope';
    min_verifier_count: number;
    verifier_mix: string[];
    dispute_policy: 'majority' | 'unanimous' | 'any-pass' | 'any-fail' | 'escalate';
    weight: number;
    notes: string;              // Generated rationale for why this tag
                                // is on the lens
  }>;
  /** Source-set bindings — references existing source_sets by id.
   *  If the skill identified new source-set candidates that the
   *  org doesn't have yet, they appear in `suggested_source_sets`
   *  for the caller to review before separately creating them. */
  source_set_bindings: string[];
  suggested_source_sets: Array<{
    proposed_name: string;
    proposed_members: Array<{
      member_kind: 'domain' | 'url' | 'repo' | 'file_collection'
                  | 'named_person' | 'database' | 'named_document_set';
      member_value: string;
      rationale: string;
    }>;
  }>;
  /** Audit metadata recorded by the substrate. */
  audit: {
    invocation_id: string;       // UUID for this skill call
    invoked_at_ms: number;
    invoker_handle: string;
    invoker_kind: 'human' | 'agent' | 'system';
    requirements_hash: string;   // SHA-256 of input.requirements
    model_used: string;          // LLM model id the skill called
    cost_estimate_usd: number | null;
  };
}
```

---

## Substrate writes

When the caller commits the lens (vs review-mode dry-run), the skill:

1. POSTs `lens` body to `POST /api/verification/lenses` → captures `lens_id`.
2. POSTs each `tag_rows[i]` to `POST /api/verification/lenses/{lens_id}/tag-rows`.
3. Records the invocation in `skill_invocations` (NEW TABLE — see Slice
   gap below).
4. Returns the populated `lens_id` + all rows + invocation_id.

In review-mode (`dry_run: true` on the input wrapper), no substrate
writes happen — the output is just the shape that WOULD have been
written.

### Substrate gap — `skill_invocations` table

The B3 milestone explicitly calls out "Every skill invocation logged
with caller identity + input requirements + output lens id". Slice
7b ships tags + lens-tag-rows endpoints; the skill-invocations log
is its own slice (B3 spec time) but the table shape needs reservation
here so the substrate stays coherent:

```sql
CREATE TABLE skill_invocations (
  id                  TEXT PRIMARY KEY,
  skill_id            TEXT NOT NULL,         -- 'create-verification-lens'
  invoker_handle      TEXT NOT NULL,
  invoker_kind        TEXT NOT NULL CHECK (invoker_kind IN ('human','agent','system')),
  scope_id            TEXT NOT NULL,
  input_requirements_hash TEXT NOT NULL,     -- SHA-256, NOT the raw text
  input_json          TEXT NOT NULL,         -- full input including raw requirements
  output_json         TEXT NOT NULL,         -- full output shape
  output_lens_id      TEXT REFERENCES verification_lenses(id) ON DELETE SET NULL,
  model_used          TEXT,
  cost_estimate_usd   REAL,
  invoked_at_ms       INTEGER NOT NULL
);
CREATE INDEX idx_skill_invocations_scope ON skill_invocations (scope_id, invoked_at_ms DESC);
CREATE INDEX idx_skill_invocations_invoker ON skill_invocations (invoker_handle, invoked_at_ms DESC);
CREATE INDEX idx_skill_invocations_output_lens ON skill_invocations (output_lens_id) WHERE output_lens_id IS NOT NULL;
```

Why the requirements_hash AND the raw input_json: raw text needed for
support cases ("which prompt produced this lens?"), hash needed for
fast dedup of identical-input calls.

---

## Prompt template — RATIFIED behaviours

JWPK eiw05zdurz msg_s1q1otis70 2026-05-28: Q1=a, Q2=b, Q3=a. The three
structural rules below are LOCKED; B2 prompt template implements
against them.

The skill's LLM prompt reads `requirements` + `framework_hint` + a
filtered tags catalog, then decides which tags to bind with what
expectations + dispute policies + which source-sets are needed,
generates a human-readable description, and refuses gracefully on
out-of-scope inputs.

### Q1 — Tags-catalog presentation (LOCKED: a)

The LLM sees **only the active `ant.*` system tags + this org's
`org.<scopeId>.*` tags**. Deprecated/superseded/withdrawn tags are
filtered out. The `framework_hint` (FCA / SEC / ESMA / etc) biases
the LLM's choices via prompt framing but does NOT further restrict
the catalog.

Implementation: `listTaxonomy({ provenance: 'system', scope_id: 'global', lifecycleStates: ['active'] })` UNION `listTaxonomy({ provenance: 'org', scope_id: input.scope_id, lifecycleStates: ['active'] })`. Result serialised as `{ id, name, description, category, protocolResolver, isRelational, familyRoot }` per tag (drop version, lifecycle, audit fields).

### Q2 — Source-set creation surface (LOCKED: b)

When the skill identifies a needed source-set that doesn't exist, it
**surfaces the proposal in `suggested_source_sets`** and ships the
lens without that binding. The caller separately reviews the
proposals + creates the source-set via `ant source-set create` if
they accept; then re-binds via a follow-up `POST /api/verification/lenses/[id]/tag-rows`.

Implementation:
- Skill resolves `bound_source_set_ids` from input against
  `listSourceSets({ ownerOrg: input.scope_id })`. Existing matches bind.
- For each missing source-set the lens needs, skill writes a
  `suggested_source_sets[i]` entry with `proposed_name`,
  `proposed_members[]` (with rationale per member), and a
  `bind_to_lens_tag_row` hint so the caller can wire it after
  creation.
- Skill NEVER auto-creates source-sets. Caller agency preserved
  (source-set governance is consequential — multi-approver model).

### Q3 — Refusal behaviour for out-of-scope inputs (LOCKED: a)

When `requirements` is clearly out of substrate scope (code linting,
image moderation, sentiment analysis, free-form open-web
fact-checking without a source-set), the skill **refuses with an
explicit `error_kind`** rather than shipping a near-empty or
closest-fit lens.

Refusal shape:

```typescript
interface SkillRefusal {
  kind: 'refusal';
  error_kind:
    | 'out_of_substrate_scope'    // not claim verification + source attribution
    | 'no_source_sets_available'  // needs sources but org has none
    | 'org_admin_required'        // caller is not org-admin for scope_id
    | 'cost_cap_exceeded'         // monthly invocation cap hit
    | 'requirements_too_vague';   // can't determine concrete tag bindings
  reason: string;                  // 1-2 sentences for the human
  suggested_action: string;        // e.g. "Run `ant source-set create` first"
  // For 'out_of_substrate_scope' specifically, the skill SHOULD also
  // surface what substrate IS for — see ant-verification.md boundaries section.
  substrate_scope_hint?: string;
}
```

Substrate is for claim verification + source attribution.
Out-of-scope refusal preserves the contract. Empty-lens-with-out-
of-scope-row was rejected (silent footgun); closest-fit-low-confidence
was rejected (substrate stays honest about its limits).

---

## Audit + per-org scoping enforcement (B3 acceptance)

The plan B3 acceptance: "Every skill invocation logged with caller
identity + input requirements + output lens id; org-scope enforced
server-side."

Implementation under the substrate:

1. Server-side authz: `requireOrgAdminAuth(input.scope_id)` runs BEFORE
   the LLM call. Non-admin returns 403 with `error_kind:
   'org_admin_required'`. F1/F2 introduces the role; until then
   admin-bearer is the gate.
2. Audit row written in same transaction as the lens POST. If lens
   POST fails server-side (validation error), the invocation row is
   still written with `output_lens_id: null` + `output_json` capturing
   the error trace. This prevents skill misuse from being silent.
3. Cost cap: per-scope monthly cap on skill invocations (F2 surface;
   placeholder counter in this milestone).
4. PII guard: skill SHOULD scrub identifiable text from
   `input_requirements_hash` precursor (NEVER hash raw PII; hash the
   normalized form). Substrate stores raw `input_json` for support;
   that's behind admin-bearer.

---

## Test plan (B2 follow-up)

When B1 spec ratifies + B2 implementation starts:

1. **Round-trip test**: feed a representative `requirements` → assert
   the output validates against the substrate (every tag_id resolves;
   every expectation enum-matches; lens kind + scope fields type-check
   against the API contract).
2. **Refusal test**: out-of-scope input → returns the configured
   refusal shape (per Q3 ratification).
3. **Audit test**: every invocation creates one `skill_invocations`
   row with the correct fields populated.
4. **Authz test**: non-admin caller against an org scope → 403 with
   the org-admin error_kind.
5. **Cost-cap test**: invocations beyond the monthly cap → 429 with
   retry-after timing.

JWPK acceptance per the plan: "JWPK reviews 1 example output before
lock". I'll prepare 3 example outputs from 3 representative
requirements once Q1/Q2/Q3 ratify so JWPK can pick the one that lands.

---

## What this spec does NOT cover

Out of scope for B1 (will land separately):

- **B2 (skill prompt template)**: actual LLM prompt text + few-shot examples
- **B3 (audit + scoping enforcement)**: `skill_invocations` table + the
  middleware that gates per-scope authz
- **B4 (three default lens scaffolds)**: link-verify-1-agent +
  link-verify-2-agent + source-context-1h1a — these get seeded
  separately, not via the skill
- **F2 premium-tier feature gate**: license-time toggle for whether
  the skill is invocable from a given tier

---

## Ratified decisions (resolved 2026-05-28)

| Q | Question | Picked | Status |
|---|----------|--------|--------|
| Q1 | Tags catalog presentation | (a) active + org-scope only | LOCKED via JWPK eiw05zdurz msg_s1q1otis70 |
| Q2 | Source-set creation surface | (b) suggest + caller-reviews | LOCKED via JWPK eiw05zdurz msg_s1q1otis70 |
| Q3 | Out-of-scope refusal | (a) explicit refusal with error_kind | LOCKED via JWPK eiw05zdurz msg_s1q1otis70 |

All three behaviours folded into the "Prompt template — RATIFIED
behaviours" section above. B2 prompt template implementation starts
next slice.
