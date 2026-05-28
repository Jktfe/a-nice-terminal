---
status: stable
last-shipped: 2026-05-28
canonical-substrate-commits:
  - 2fd8b14   # Slice 1 — verification_taxonomy + 25-tag seed
  - 9afb671   # Slice 2 — source_sets
  - 2997054   # Slice 3 — tagging_anchors + tag_applications + tagging_runs
  - 1e71cd1   # Slice 4 — tag_application_overrides
  - 01d1905   # Slice 5 — rename validation→verification + lens_tag_rows
  - 23857d0   # Slice 6 — verification_observations append-only refactor
  - 0fa2670   # Slice 7a — CLI-facing endpoints
  - 6107633   # Slice 7b — Author-UI endpoints
  - c1b1c14   # Slice 8 — A10 V3 derivation refactor
  - 12fbec2   # Slice 9 — three default lens scaffolds (B4)
---

# ANT Verification — concept overview

ANT Verification is the substrate ANT uses to track **whether claims
in any content can be verified, by whom, under what protocol, against
what sources**. It separates four things that legacy validation
systems collapse into one:

1. **What kind of content is this?** (tagging taxonomy)
2. **Who verifies what, how?** (lenses + lens-tag-rows)
3. **What's the verdict?** (verification_observations append-only chain)
4. **Where do trusted sources come from?** (source-sets)

Each is a first-class substrate primitive with its own table, its own
audit log, and its own governance rules. The composition is what
makes verification flexible: an org can change ONE lens without
touching tag definitions; agents can apply tags without knowing what
lens will eventually read them; humans can override a specific tag
application without rewriting the lens.

## The four primitives

### 1. Tags — verification_taxonomy

A **tag** is a typed labelling primitive: `claim.factual`,
`source.primary`, `link.html`, `process.flagged-ignorable`. Every
piece of content the substrate cares about gets tagged with one or
more of these. Tags are governance objects, not prompt fragments:

- **Versioned**: editing a tag publishes a new version row, old
  versions retained. Historical applications resolve against their
  original tag definition (replayable audit).
- **Lifecycled**: proposed → active → deprecated → superseded →
  withdrawn. Hard-delete forbidden (substrate invariant).
- **Provenance-scoped**: `system` (ANT defaults under `ant.*`
  namespace) vs `org` (per-org extensions under `org.<orgId>.*`)
  vs `user`. System tags can't be overridden by orgs; orgs extend
  by adding their own.
- **Protocol-classified**: each tag declares how it gets verified —
  `deterministic` (exact match), `heuristic` (single verifier),
  `judgement-required` (human required), `consensus-required`
  (multiple verifiers must converge). Some tags use a *conditional*
  resolver — e.g. `claim.factual` is deterministic when a primary
  source exists, heuristic otherwise.
- **Relational**: tags like `source.supports-claim.<claimId>` carry
  a target. Stored once as `source.supports-claim` family root;
  applications use the parameterised form.

Default 25-tag set covers 8 categories: claim, source, link, data,
identity, content, context, process. Plus 2 relational families
(supports-claim, refutes-claim).

**Store**: `src/lib/server/verificationTaxonomyStore.ts`
**Endpoints**: `/api/tags` (CRUD), `/api/tags/[id]/deprecate`,
`/api/tags/[id]/audit`

### 2. Source-sets — source_sets + source_set_members

A **source-set** is a named, governed collection of trusted sources
that lenses bind to. Members are typed: `domain` (fca.org.uk),
`url`, `repo`, `file_collection`, `named_person`, `database`,
`named_document_set`.

Key invariants:

- **Per-org ownership**: every set has `owner_org` NOT NULL. No
  global/public source-sets in the substrate; orgs build their own.
- **Scope-kind**: `org-wide` (used across many lenses) vs
  `lens-specific` (bound to one lens via `bound_lens_id`).
- **Approver gate**: `approvers_json` lists handles required to
  approve changes. Multi-party approval for high-stakes sets.
- **Review cadence**: `review_cadence_ms` + `last_reviewed_at_ms`
  drive review reminders. Lens-specific sets typically have shorter
  cadences.
- **Lifecycled**: proposed/active/deprecated/withdrawn. Member
  add/remove is soft-deleted (preserves "we trusted X from D1 to D2"
  history).
- **Append-only audit**: every action recorded in `source_set_audit`
  (create/rename/add_approver/remove_approver/deprecate/restore/
  review_checkpoint/add_member/remove_member).

ANT ships NO default source-sets (per JWPK direction during
ratification — orgs build their own; canned FCA/ONS lenses were
explicitly removed).

**Store**: `src/lib/server/sourceSetsStore.ts`

### 3. Tagging anchors + applications — tagging_anchors + tag_applications + tagging_runs

A **tagging anchor** is a content-type-agnostic pointer to a fragment
of content (a paragraph in a doc, a region in a PDF, a range in a
spreadsheet block). `content_kind` enum: `univer-block` /
`markdown-offset` / `pdf-region` / `image-region` / `audio-timestamp`
/ `message-range` / `file-checksum`. The substrate treats the
`anchor_data_json` payload as opaque; adapter modules outside the
substrate interpret per content-kind.

The `content_hash` on each anchor is the **re-verification trigger**:
when an artefact's hash diverges, lenses with
`re_verification_on_content_change=true` re-run affected applications.

A **tag application** is an immutable record: "tag X applied to
anchor Y by Z at T". Each row carries `(tag_id, tag_version)` so
historical applications resolve against their original tag
definition. For relational tags, `target_claim_id` carries the claim
being supported/refuted.

A **tagging run** groups applications: one `ant tags apply <scope>`
invocation creates one run; applications written during the run
share `tagging_run_id`. The UI lists runs latest-first and drills
into the applications produced by each.

**Store**: `src/lib/server/tagApplicationsStore.ts`
**Endpoints**: `POST /api/scopes/[scopeId]/tagging-runs`

### 3a. Per-application overrides — tag_application_overrides

A tag application can be overridden after the fact without
rewriting the tag definition. Three override kinds:

- `classification` — changes the verification protocol class for
  this specific application (e.g. demote `consensus-required` to
  `heuristic` when context warrants).
- `flag_ignorable` — marks the application as ignorable. Lens
  evaluators skip ignorable applications (handles "this is a joke
  claim" / "this is an example, not an assertion").
- `withdraw` — cancels the most recent non-withdraw override,
  revealing the prior override (or original if none).

Append-only. `reason` is REQUIRED on every row (audit-of-flagger).
Effective state computed by walking the chain newest-first;
withdraw rows pop subsequent non-withdraw rows.

**Store**: `src/lib/server/tagApplicationOverridesStore.ts`

### 4. Lenses + lens-tag-rows — verification_lenses + lens_tag_rows

A **lens** is a named verification schema that decides, for a given
piece of content, whether it passes/fails/disputes/etc under a
specific verification protocol. It composes tags via **lens-tag-rows**:
each row binds one (tag, expectation, dispute-policy, verifier-mix,
weight) tuple.

Expectations: `required` / `forbidden` / `consensus-required` /
`heuristic-allowed` / `out-of-scope`.

Dispute policies (how disagreement between multiple applications of
the same tag resolves): `majority` / `unanimous` / `any-pass` /
`any-fail` / `escalate`.

Lenses also carry temporal rules:

- `minimum_pass_record_age_ms` — don't accept a `pass` verdict until
  the source record is older than N ms (guards against
  just-published-then-edited claims).
- `re_verification_on_content_change` — trigger re-run when anchor
  content_hash drifts.
- `out_of_scope_tags_json` — tags whose application excludes a
  fragment from this lens entirely.

ANT ships three **scaffold lenses** (B4): `lens-link-verify-1-agent`,
`lens-link-verify-2-agent`, `lens-source-context-1h1a`. Not canned
regulatory lenses — orgs build their own via the lens-creation skill
(B1-B3).

**Stores**: `src/lib/server/validationLensStore.ts` (lenses) +
`src/lib/server/lensTagRowsStore.ts` (rows)
**Seed**: `src/lib/server/verificationLensSeed.ts`
**Endpoints**: `/api/verification/lenses` (CRUD) +
`/api/verification/lenses/[id]/tag-rows`

### 5. Verdicts — verification_observations (append-only)

Every verification run records a **verdict** against `verification_observations`.

Eight verdict statuses:

- `pending` / `running` — in-flight
- `passed` / `failed` — legacy terminal
- `waived` — caller waived the verification
- `dispute` — verifier flagged disagreement; `dispute_reason`
  required
- `insufficient_evidence` — verifier couldn't reach confidence
  threshold; `result_json` carries the trace
- `retag_required` — underlying tag applications are stale or wrong;
  lens can't evaluate until retagging completes

**Append-only**: `recordVerdict()` always INSERTs; corrections
happen by writing a new row linked via `parent_observation_id`. The
effective verdict per (lens_id, claim_anchor) is the most-recent row
via `getEffectiveVerdict()`. The chain is the audit log.

**Store**: `src/lib/server/verificationVerdictsStore.ts`
**Endpoints**: `POST/GET /api/scopes/[scopeId]/verification-runs`

## The composition — what a verification looks like end-to-end

1. **An artefact lands in the substrate** (a doc, a memo, a marketing page).
2. **`ant tags apply <scope>`** runs against the artefact:
   - Server starts a `tagging_run`.
   - For each claim/source/link the agent identifies, server writes a
     `tagging_anchor` + a `tag_application` row.
   - Server completes the run.
3. **`ant verify <scope> --lens <lens-id>`** runs:
   - Server reads the lens's `lens_tag_rows`.
   - For each row, finds matching tag applications on the artefact.
   - Applies dispute policy + verifier-mix + temporal rules to
     compute a verdict.
   - Writes the verdict as a `verification_observations` row.
4. **The Trust chip on Mac antchat / iOS antios** queries
   `GET /api/chat-rooms/[roomId]/validation-summary` (V3 contract,
   9-field payload). The endpoint aggregates verdicts across all
   artefacts in the room into the locked payload shape.
5. **Critical gaps surface** — failed-validation, disputed-verdict,
   retag-required rows appear in `criticalGaps` for the user to act
   on.
6. **Overrides happen** — if a verdict is wrong (a real claim flagged
   as a joke), the user writes a `tag_application_override` with
   mandatory reason; the chain captures the correction.

## V3 contract — what apps consume

`GET /api/chat-rooms/[roomId]/validation-summary` returns a **locked
9-field payload**:

```typescript
{
  defaultLensId: string | null,
  recentRunCount: number,
  pendingTaskCount: number,
  overallTrustScore: number | null,       // 0-1 raw
  trustState: 'passed' | 'failed' | 'pending' | 'stale' | 'unknown',
  criticalGaps: Array<{
    claimAnchor: string,
    kind: 'failed-validation' | 'disputed-verdict' | 'retag-required',
    reason: string
  }>,
  sheetUrl: string,
  evidenceFormUrl: string | null,
  validationUxEnabled: boolean
}
```

**The shape is invariant**. A10 (Slice 8) refactored the derivation
under the new substrate but the payload key set is locked. Future
shape changes ship as `validation-summary-v4` at a new endpoint
path, not as silent shape mutations.

Server owns trust classification + stale policy. Clients render
platform-native colours from `trustState`; they do NOT compute
thresholds. `criticalGaps.kind` discriminator drives narration ("3
disputed claims") — clients render distinct icons/copy per kind.

## Boundaries — what verification IS and ISN'T

**Verification IS**:
- Claim attribution: "this claim is supported by this source"
- Source-context: "this source is primary / reputable / supports
  the claim / refutes the claim"
- Link checking: "this URL resolves to expected content"
- Direct-quote integrity: "this quote matches the source verbatim"
- Multi-verifier consensus / dispute resolution

**Verification ISN'T**:
- Code correctness (use type checkers, test runners)
- Content moderation (a separate substrate concern)
- Sentiment analysis
- Image / video classification
- Free-form fact-checking against the open web (out of scope without
  a source-set binding)

When `requirements` for the lens-creation skill (B1-B3) is clearly
out-of-scope, the skill refuses with an explicit `error_kind`
rather than shipping a closest-fit lens silently.

## Org governance — F1/F2 substrate

License-time provisioning (Phase F1) registers an org's namespace
(`org.<orgId>.*`) + assigns the `org-admin` role to the license
holder. Tag CRUD + lens CRUD + lens-tag-row CRUD + skill invocation
all gate on `org-admin` for org/user-scoped tags + lenses
(system-scoped is admin-bearer-only).

Premium-tier feature gates (Phase F2) determine which surfaces are
invocable: Browse / Apply / Run-Lens / Audit are OSS; Author /
Lens-Designer / Lens-Creation-Skill are premium.

These gates are server-authoritative — client hiding is UX convenience
only.

## Cross-platform fan-out

**Mac antchat** (Phase C):
- M9: Trust chip in room header (consumes V3)
- M10: Lens designer (premium tier, org-admin)
- M11: Verification Tags page (Browse/Author/Audit)
- M12: Per-application override UX (right-click → mandatory reason)

**iOS antios** (Phase D):
- D1: Trust chip in iOS room header (shipped 2026-05-28 after A10)
- D2: Tag chip overlay + long-press lodge-dispute
- D3: Lens picker + Author wizard (paginated)
- D4: Per-application override (long-press → action sheet)
- D5: Per-application override audit feed

**Web** (substrate boundary):
- `/verification/lenses` (lens authoring fallback)
- `/verification/tags` (tag browse)
- `/validation/rooms/[id]` (sheet URL canonical)

## Related substrate

- **Chair primitive** (`docs/concepts/ant-chair.md`) — Room Chair
  drives validation-task progression via the V3 endpoint;
  ANT Chair translates verification verdicts to user decision cards.
- **Stage primitive** (`docs/concepts/ant-stage.md`) — Stage
  presentations can carry inline forms that submit verification
  observations (deferred feature; not yet shipped).
- **Memory pack** (`docs/concepts/_manifest.md`) — verification
  configuration (lens preferences per room) is bankable to user
  memory vault; lens-attach-to-room is a future primitive.

## Pointers — files to read first

- `src/lib/server/verificationTaxonomyStore.ts` — tag governance
- `src/lib/server/sourceSetsStore.ts` — source-set primitive
- `src/lib/server/tagApplicationsStore.ts` — anchors + applications + runs
- `src/lib/server/tagApplicationOverridesStore.ts` — per-application overrides
- `src/lib/server/lensTagRowsStore.ts` — lens authoring rows
- `src/lib/server/verificationVerdictsStore.ts` — append-only verdict log
- `src/lib/server/verificationLensSeed.ts` — three default lens scaffolds
- `src/routes/api/scopes/[scopeId]/tagging-runs/+server.ts` — CLI verb backend
- `src/routes/api/scopes/[scopeId]/verification-runs/+server.ts` — CLI verb backend
- `src/routes/api/chat-rooms/[roomId]/validation-summary/+server.ts` — V3 contract

## Open work

Phase A (substrate) — **COMPLETE** as of 2026-05-28.

Phase B (lens-creation skill):
- B1 spec — DRAFT at `docs/specs/create-verification-lens-skill.md`
  pending JWPK ratify on three structural questions (tags catalog
  presentation / source-set creation surface / out-of-scope refusal).
- B2 prompt template — depends on B1 ratification.
- B3 audit + per-org scoping enforcement (`skill_invocations` table) — depends on B1+B2.
- B4 default lens scaffolds — **SHIPPED** at 12fbec2.

Phase C (Mac antchat), Phase D (iOS antios), Phase E (Bridge C),
Phase F (account-management gating), Phase G (docs/onboarding) — owned
by respective lane agents.
