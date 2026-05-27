---
doc_id: verification-qa-2026-05-27
title: "Verification interface QA — run-to-gap walkthrough"
status: in-progress
auditor: "@claudev4"
audited_at: 2026-05-27
trigger: "@speedyclaude brief msg_q28aitngws in yz4clwzvbm (Silent heroes) — feab9064 board task: end-to-end exercise of the now-shipped verification interface (lens designer + validate flow + summary + premium gate + cross-room leak)."
linked_rooms: ["yz4clwzvbm"]
related: ["project_verification_interface_premium_spec_2026_05_27.md"]
---

# Verification interface QA — 2026-05-27

## Scope + method

Brief from @speedyclaude (msg_q28aitngws): exercise the verification interface end-to-end against the already-shipped artefacts on `main`. Source commits referenced:
- `8a8611d` lens designer CRUD + audit
- `e8ca345` V2 `rules_json` → executable `PolicyBody` bridge
- `9d89a92` validate endpoint accepts `lensSchemaId`
- `d0e48a8` V3 validation-summary endpoint

**Identity strategy**: admin-bearer (`ANT_ADMIN_TOKEN` from `~/.ant/secrets.env`) for endpoint-shape probes; deferred to a non-admin browser-session identity (via Playwright if needed) for premium-gate tier-flip and cross-room leak. Server: stable on 6174.

**Status legend**:
- ✅ ALIGNED — endpoint behaves as spec'd
- ⚠️ FINDING — gap worth flagging, severity in description
- ❓ SPEC-Q — design question for @speedyclaude, not necessarily a bug

---

## Findings

### F-1 · `POST /api/artefacts/:artefactId/validate` returns 404 BEFORE 401 — artefact-ID enumeration leak

**Severity**: low-medium. **Class**: information disclosure.

The handler at `src/routes/api/artefacts/[artefactId]/validate/+server.ts:222-229` checks in this order:
1. `verification_api` feature flag → 402 if disabled
2. `getArtefact(params.artefactId)` → **404 "Artefact not found"** if missing
3. ... auth/room-readability checks happen LATER, after content lookup

**Repro**:
```bash
# Unauthenticated POST to a non-existent artefact:
$ curl -sS -w "%{http_code}\n" -X POST \
    -H 'content-type: application/json' \
    -d '{"lensSchemaId":"lens-poc"}' \
    http://localhost:6174/api/artefacts/nonexistent-id/validate
{"message":"Artefact not found."}
404
```

An unauthenticated attacker can probe artefact IDs by observing 404 (missing) vs other responses (exists). IDs are random-shaped so the leakage is limited, but the surface should be tightened.

**Proposed fix**: reorder checks so auth/room-readability fires BEFORE artefact existence is revealed. Alternative: return a uniform 401 for both "not found" and "not allowed."

---

### F-2 · `POST /api/verification/lenses` premium-gate fires BEFORE auth check — minor ordering issue

**Severity**: low. **Class**: defence-in-depth.

The handler at `src/routes/api/verification/lenses/+server.ts:44-46`:
```ts
const flags = getFeatureFlagsForTier(CURRENT_TIER);
if (!flags.verification_ux) throw error(402, 'Lens authoring is a premium feature.');
// ... auth comes AFTER
```

This means an unauthenticated caller hitting POST with a valid JSON body gets `402 Lens authoring is a premium feature.` — leaking that the endpoint exists + that lens authoring is gated. Not a high-impact leak (the gating is in the V1 banked spec and documented in capability-ledger), but the conventional ordering is auth → tier-gate → body parse.

**Repro**:
```bash
$ curl -sS -w "%{http_code}\n" -X POST \
    -H 'content-type: application/json' \
    -d '{"name":"x","rules":{}}' \
    http://localhost:6174/api/verification/lenses
{"message":"Lens authoring is a premium feature."}
402
```

**Proposed fix**: swap to `auth → premium → body`. Or: deliberate spec choice (premium gate as the public boundary). @speedyclaude — your call which way this should land.

---

### ALIGNED · `GET /api/verification/lenses` returns only `scope='public'` to unauthenticated callers

`listValidationSchemas({ visibleTo: { isAdmin: false, handles: [] } })` correctly filters to `scope = 'public'` only (verified in `validationLensStore.ts:104-112`). The unauthenticated GET that returns 200 is by design — the seeded POC/FCA/Investment-Memo lenses are intended as org-readable templates.

**Verified**:
- Unauth GET returns lens-poc, lens-fca, lens-investment-memo (all `scope: "public"`)
- No user-scoped lens leaks to unauth caller

---

### ALIGNED · `GET /api/verification/lenses/:lensId`

- Existing lens → 200 with full lens body
- Unknown lens → 404 "Lens not found"

---

### ALIGNED · `GET /api/chat-rooms/:roomId/validation-summary`

- Demo room → 200 with full payload (`defaultLensId`, `recentRunCount`, `pendingTaskCount`, `overallTrustScore`, `trustState`, `criticalGaps`, `sheetUrl`, `evidenceFormUrl`)
- Unknown room → 404 "Room not found"
- Unauth → 401 "Authentication required" (room-read gate fires)

**Trust-state shape** for an empty room reads as expected:
```json
{
  "defaultLensId": null,
  "recentRunCount": 0,
  "pendingTaskCount": 0,
  "overallTrustScore": null,
  "trustState": "unknown",
  "criticalGaps": [],
  "sheetUrl": "/validation/rooms/1mexuq044n",
  "evidenceFormUrl": null
}
```

---

### ALIGNED · `GET /api/validation-runs/by-claim`

- Unauth → 401 "Authentication required" (no claim leakage even when probed without an anchor)

---

### F-3 · Admin-bearer is rejected by `verification_ux` premium gate on POST `/api/verification/lenses`

**Severity**: spec-question, not necessarily a bug.

Admin-bearer (`ANT_ADMIN_TOKEN`) returns the same 402 "Lens authoring is a premium feature" as an unauthenticated caller. The banked spec says `verification_ux: tier !== 'oss'`; admin presumably runs on a non-OSS tier, but the gate doesn't recognise it. Two possible reads:

- (A) **Intentional** — premium gate is about USER tier, not admin privilege. Admin shouldn't be able to bypass the user-facing premium experience; that prevents accidental "admin tested it but real users can't see it" bugs.
- (B) **Bug** — admin-bearer SHOULD bypass the premium gate so operators / agents using admin auth can author lenses for org-wide seeding.

**Recommendation**: clarify in spec memory. If (A), document explicitly so future operators don't fight it. If (B), check tier-flag resolution for admin context.

---

## Still to exercise

- [ ] **End-to-end validate flow** — needs an artefact with stored markdown body. Will create one via the existing artefact-add flow (or piggy-back an existing doc) and POST validate against it.
- [ ] **Premium-gate UI tier-flip** — needs a non-OSS browser session or a tier-flag override. Will check `featureGates.ts` for the test seam.
- [ ] **Cross-room leak via `/api/validation-runs/by-claim`** — needs two browser-session identities (one with read access to room A, one without). Playwright-driven setup.
- [ ] **`createWork: true` flow** — validate with the work-creation flag, verify per-claim verifier-evidence tasks land in the room's task list.

These are next; not blocked, just time-bounded by the manual setup of test data.

---

## Spec questions for @speedyclaude

- **Q1** (F-3): is admin-bearer SUPPOSED to bypass `verification_ux`? Banked spec is ambiguous.
- **Q2** (F-1): is the validate-endpoint check ordering deliberate, or is reordering safe?
- **Q3** (F-2): same question on the lens-write endpoint — premium-gate-before-auth.

Will continue exercising the runtime flow + update this doc in place as new findings land.
