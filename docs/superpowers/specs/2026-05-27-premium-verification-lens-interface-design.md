# Premium Verification Lens Interface Design

## Status

Design draft for the premium verification interface. This spec covers the web fallback UI and server contract that native apps will consume. Native Mac/iOS UI is out of scope for this repo slice.

## Goal

Premium users can design a verification lens that defines what it means for a claim, deck, document, or artefact to be "verified to X level". The lens must be executable by agents and humans, not just a display label.

## Existing System Fit

ANT already has:

- `verification_policies`: executable policy bodies, audit trail, owner visibility, and premium gates.
- `validation_schemas`: Stage-facing lens labels and validation run grouping.
- `POST /api/artefacts/:artefactId/validate`: extracts claims, scores them against a policy, and can create verifier work.
- `validation_runs`: persisted evidence from verifier work.

This design makes `verification_policies` the source of truth for executable lens rules. `validation_schemas` can point at, mirror, or display those policies, but schema ids must not be treated as executable policy slugs unless explicitly bridged.

## User Experience

The premium interface has two modes.

### Run Verification

The user selects an artefact, deck, or document, chooses an executable lens, and sees:

- extracted claim rows;
- current verified/unverified state per claim;
- evidence already present;
- missing verifier slots;
- a create-work action for missing slots.

### Design A Lens

The user edits a table of verifiable block types. Each row defines how that block is verified:

- agents: count plus optional specific agent handles;
- people: count plus optional specific people;
- sources: count plus optional source labels;
- files: count plus optional artefact/file ids;
- file systems: count plus optional allowed roots/paths;
- websites: count plus optional allowed domains or URLs;
- context summaries: count;
- none: explicit waiver/label-only behavior for blocks that do not need independent verification.

## V2 Rule Body

The authoring UI saves this V2 shape inside `verification_policies.policy_json`:

```json
{
  "version": 2,
  "blocks": {
    "claim_material": {
      "mode": "all",
      "requirements": [
        { "kind": "agent", "count": 2, "specific": ["@speedyclaude"] },
        { "kind": "person", "count": 1, "specific": ["@james"] },
        { "kind": "source", "count": 1, "allowedSources": ["board-pack", "room-memory"] }
      ]
    },
    "number": {
      "mode": "any",
      "requirements": [
        { "kind": "agent", "count": 2 },
        { "kind": "file", "count": 1, "specificFiles": ["artefact:abc123"] },
        { "kind": "website", "count": 1, "allowedDomains": ["fca.org.uk"] }
      ]
    },
    "opinion": {
      "mode": "none",
      "reason": "This lens does not require independent verification for opinion claims."
    }
  },
  "fallback": {
    "mode": "all",
    "requirements": [
      { "kind": "agent", "count": 1 }
    ]
  }
}
```

### Rule Semantics

- `mode: "all"` means every requirement row must be satisfied.
- `mode: "any"` means any one requirement row can satisfy the block.
- `mode: "none"` means explicitly waived or label-only; it is not an accidental empty config.
- `kind` is one of `agent | person | source | file | filesystem | website | context_summary`.
- `specific` constrains eligible agents or people when present.
- `allowedSources`, `specificFiles`, `allowedFileSystems`, and `allowedDomains` constrain source evidence.
- Missing arrays mean any eligible verifier/source of that kind can satisfy the requirement.

## Server Contract

The server should expose CRUD endpoints for native apps and the web fallback:

- `GET /api/verification/lenses` — list readable executable lenses.
- `POST /api/verification/lenses` — create a lens from V2 rule body.
- `GET /api/verification/lenses/:slug` — read one lens plus audit summary.
- `PATCH /api/verification/lenses/:slug` — update metadata or rule body.
- `POST /api/verification/lenses/:slug/clone` — fork a readable lens.
- `DELETE /api/verification/lenses/:slug` — soft-delete with audit reason.

These can wrap existing policy routes where practical, but response bodies should use the word `lens` for app-facing clarity.

## Audit

Every create/update/delete/clone writes to the existing verification policy audit trail. The audit entry must include:

- actor handle;
- actor kind;
- action;
- before/after policy body;
- reason when supplied;
- timestamp.

## Premium Gate

Lens authoring is premium-gated by `verification_ux` and/or `policy_controls` feature flags.

OSS users may see read-only public lens names where needed to interpret results, but cannot create or edit lenses.

## Native App Contract

Native apps should not parse legacy policy shortcuts directly. They consume the V2 lens body and render it as rows. The web fallback uses the same contract so app teams can treat it as a reference implementation.

## Transition From Legacy Policies

Current scorer/orchestrator understands a legacy compact body:

```json
{
  "blocks": {
    "claim_material": { "agents": 2, "AND_humans": 1 }
  },
  "fallback": { "agents": 3, "OR_humans": 1 }
}
```

During transition, the verification bridge lowers V2 requirements into the legacy scorer where possible:

- `agent` maps to `agents`;
- `person` maps to `humans`;
- `file`, `filesystem`, `website`, and `source` map to file/source evidence until richer verifier kinds land;
- `context_summary` maps to context summary evidence;
- `mode: none` produces a no-verification-required requirement.

The lowering must be deterministic and tested. If a V2 rule cannot be lowered safely, the endpoint returns a validation error rather than silently weakening the lens.

## Non-Goals

- No native Mac or iOS UI in this slice.
- No crawler for arbitrary file systems or websites in V1.
- No claim extraction rewrite in this slice.
- No automatic trust of sources without a validation run or explicit waiver.

## Implementation Decision

V2 lowering should live in a new `validationPolicyCompiler.ts`. `validationScoring.ts` and `validationOrchestrator.ts` should stay focused on already-compiled requirements. Route handlers should call the compiler before scoring or planning orchestration.
