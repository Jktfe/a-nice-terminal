# ANT Enterprise Ready — Plan-Mutation Proposal

**Author:** @2ec (was @cv4 in prior sessions)
**Date:** 2026-05-30
**Triggering ask:** JWPK BIG ANT (bs58y3h57l) msg_bf283a56dy — *"Review the codebase and plans - update and attach plans accordingly to get ANT enterprise ready"*
**Status:** AWAITING JWPK RATIFICATION — no mutations made yet
**Process discipline:** doc-first per [[feedback-spec-freeze-should-be-a-doc-not-iterated-messages-2026-05-27]]. One round of consolidated feedback then I act.

---

## TL;DR

16 plans on the local server. 6 are stale (zero activity + zero acceptance criteria), 2 pairs duplicate each other, and 9 enterprise pillars have no plan coverage. The substrate is further along than the plans suggest — V2 verification, F1 orgs, Stage A+B permissions, and identity v0.2 are SHIPPED; the missing work is the *enterprise wrap* (RBAC registry, audit exporters, billing, SSO, observability, DR, data portability, compliance reports) plus the V3 validation-summary endpoint contract that's documented but not implemented.

Proposal: (a) archive 5 stale plans, (b) consolidate 3 plan pairs, (c) extend `antos-enterprise-control-plane-2026-05-27` with M6-M14 covering the 9 missing pillars, (d) attach the resulting active plan set to BIG ANT as room artefacts.

---

## What's actually shipped (Tier 1 — done)

Sourced from `git log --since=2026-05-23 main` + file-level audit by parallel Explore agents.

| Subsystem | Evidence |
|-----------|----------|
| Identity v0.2 (11-table schema, multi-device keys, recovery grants, super-admin rotation) | `identities`, `identity_keys`, `identity_attestations`, `recovery_grants` tables; `identityKeysStore.ts`; commits b39bf93, 042868a, eb34bd0 |
| F1 orgs (namespace, org_admins, tier oss/premium/enterprise) | `orgsStore.ts` + `/api/orgs/*`; UNIQUE INDEX on namespace_prefix |
| Permission requests (Stage B) | `permissionRequestsStore.ts` + `/api/permission-requests/*`; TTL sweep job; 403 parking |
| Permission grants (Stage A `grants_shim`) | `grantsShimStore.ts` + `/api/grants/*`; scope ∈ {once, always-for-room, always-for-agent} |
| Verification substrate (V2 Phase A) | `verificationLensApi.ts`, `verificationTaxonomyStore.ts`, `validationLensStore.ts`, `lensTagRowsStore.ts`, `sourceSetsStore.ts`, `validationOrchestrator.ts` |
| Source-sets HTTP surface (M5.1 slice 1) | `/api/source-sets/+server.ts` + `/api/source-sets/[setId]/+server.ts`; 16 tests passing; commit 0e09676 |
| Cookie logout + Sign out button | commits 2587c6c, 70f8822 |
| Security hardening (6 iterations this week) | sec-iter1-6: handle spoof, admin gate, unauth hijack closures |

## What's partial (Tier 2 — needs finishing)

| Subsystem | What's there | What's missing |
|-----------|--------------|----------------|
| F2 premium-gate enforcement | Gate 1 (`featureGates.ts` tier discovery); `requireVerificationAuthorTier()` helper | Gate 2 (enforcement applied across all premium endpoints) — partial coverage |
| RBAC | Endpoint-level gates (room_owner, org_admin, plan_owner, isAdminBearer) | Central role registry + role hierarchy + pre-seeded tool_grants per role |
| Audit events | Per-domain stores (`bring_in_app_launches`); audit verbs catalog (PR-D, 2026-05-28) | System-wide append-only `audit_events` table per v0.2 spec; not yet a unified store |
| Source-set governance | M5.1 slice 1 (HTTP CRUD) shipped | M5.2 lifecycle transitions, M5.3 member management, M5.4 audit chain, UI shell |
| `agents` vs `identities` table collapse | Both exist after Option D rebase | **Unresolved per Option D §6** — same table or FK relationship? Needs JWPK ratification before further M5/M6 work |

## What's missing (Tier 3 — no code yet)

These 9 are the "enterprise wrap." Each maps to a proposed M6-M14 milestone on `antos-enterprise-control-plane-2026-05-27`.

| # | Pillar | Why it blocks enterprise | First file to create |
|---|--------|---------------------------|----------------------|
| M6 | Fine-grained RBAC + role registry | Procurement asks "show me your role model" — endpoint-level gates aren't enumerable | `src/lib/server/rolesRegistryStore.ts` + `/api/roles/*` |
| M7 | SIEM exporters + audit webhooks | SOC2 / ISO27001 require external audit log retention | `src/lib/server/auditEventsStore.ts` + `/api/audit/export` + webhook config |
| M8 | V3 validation-summary 9-field endpoint | Contract LOCKED in `docs/concepts/ant-verification.md` but endpoint not built | `src/routes/api/chat-rooms/[roomId]/validation-summary/+server.ts` |
| M9 | Billing + metering substrate | Enterprise tier exists in F2 but no usage attribution to bill against | `src/lib/server/billingStore.ts` + Stripe webhooks + per-org consumption events |
| M10 | SSO/SAML | Listed in ENTERPRISE_FEATURES; zero implementation | `src/lib/server/ssoProvider.ts` + `/api/auth/sso/*` |
| M11 | Observability + metrics endpoint + SLO | No prometheus/OTel; no SLA contract | `src/routes/api/metrics/+server.ts` + SLO doc |
| M12 | Backup + restore + DR automation | Only deck export exists; nothing org-level | `scripts/ant-org-backup.mjs` + `scripts/ant-org-restore.mjs` |
| M13 | Data portability + GDPR right-to-delete | No data-export verb, no purge primitive | `src/routes/api/identity/[id]/export/+server.ts` + `purge` verb |
| M14 | Compliance reporting (SOC2/ISO27001) | Verification evidence chain exists, no regulator-shaped output | `src/lib/server/complianceReportRenderer.ts` |

## Plan-state recommendations

### Archive (5)
All zero acceptance criteria + no activity since creation. Discoverable noise on the plans list.

- `stage-primitive-v1` (created April 2026, never updated)
- `antios-fully-functional-simulator-2026-05-26`
- `remoteant-homebrew-functional-2026-05-26`
- `antios-usability-v4-2026-05-26`
- `antios-usable-testflight-2026-05-26`

### Consolidate (3 pairs)

- **Mac antchat dupe:** `mac-native-antchat-homebrew-2026-05-27` ↔ `antchat-mac-native-2026-05-27` — same scope, two plans. Keep `antchat-mac-native-2026-05-27` (has M0-M8 outline), archive the other.
- **macOS delivery overlap:** `remoteant-mac-delivery-2026-05-29` (16 milestones) ↔ `antchat-mac-native-2026-05-27` — overlapping macOS work. **Recommend keeping both** because they have distinct scopes (remoteANT MCP-stdio adapter vs antchat UX contract); add a "boundary" note to each pointing at the other so future readers don't conflate.
- **iOS fragmentation:** `antios-fully-functional-simulator`, `antios-usability-v4`, `antios-usable-testflight`, `antios-make-it-functional` — four iOS plans for overlapping work. **Recommend:** archive the three stale ones (already in archive list above), keep `antios-make-it-functional-2026-05-26` (has 3 explicit acceptance criteria from JWPK /goal msg_als2fod2al) AND `antios-delivery-completion-2026-05-29` as the active plan-of-record. Add cross-link.

### Extend (1)

Add M6-M14 sections to `antos-enterprise-control-plane-2026-05-27` per the Tier 3 table above. Each milestone gets 1-3 acceptance criteria and 1-3 tasks.

### Leave as-is (the 7 active plans)

- `antos-mac-delivery-2026-05-29`
- `antios-delivery-completion-2026-05-29`
- `remoteant-mac-delivery-2026-05-29`
- `big-boy-pants-100-delivery-2026-05-29` (meta-plan)
- `ant-verification-2026-05-28`
- `answer-once-delivery-2026-05-28`
- `antchat-mac-native-2026-05-27`

## Attach to BIG ANT

After mutations, attach the 8 active enterprise-relevant plans to room `bs58y3h57l` as artefacts via `ant artefact add` so BIG ANT becomes the canonical room view of the enterprise delivery contract:

1. `antos-enterprise-control-plane-2026-05-27` (extended)
2. `ant-verification-2026-05-28`
3. `answer-once-delivery-2026-05-28`
4. `big-boy-pants-100-delivery-2026-05-29` (meta)
5. `antos-mac-delivery-2026-05-29`
6. `antios-delivery-completion-2026-05-29`
7. `remoteant-mac-delivery-2026-05-29`
8. `antchat-mac-native-2026-05-27`

## Open questions for JWPK

These need ratification BEFORE I mutate. One-line answers are fine; "yes do it all" is fine too.

1. **Scope of "enterprise ready":** pilot-ready (single design partner like NMVC) vs GA-ready vs Fortune-500-procurement-ready (SOC2 audit, SSO mandatory, EU data residency)? Each implies very different scope on M9-M14.
2. **`agents` vs `identities` table:** collapse into one (per my Option D §6 flag) or keep both with FK? Blocks M6 (RBAC registry needs to attach roles to an identity table).
3. **NMVC Answer Once pivot relationship:** msg_1kalaay5ky pivoted toward dogfood-first. Treat enterprise readiness as orthogonal (substrate work for ALL customers) or as the path that lets NMVC dogfood land safely?
4. **Archive list:** any of those 5 you want to KEEP for historical/learning reasons rather than archive?
5. **Order of operations on M6-M14:** parallelisable across lanes (M6 + M7 + M8 + M11 are mostly independent) — should I dispatch sibling subagents or keep all on my plate?

## Process notes

- No code mutations yet. Only this doc.
- Will post ONE short message to BIG ANT linking this file.
- Will NOT iterate in-room (per banked spec-freeze discipline).
- After ratification, executes in this order: archive → consolidate → extend → attach → final ACK with delta summary + event IDs.
