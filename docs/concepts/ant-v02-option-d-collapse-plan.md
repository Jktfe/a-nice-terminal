---
title: ANT v0.2 — Option D Collapse Plan
date: 2026-05-30
authors: ["@cv4"]
status: ratified by JWPK msg_bby3p17jk6 ("do it properly - don't cut corners") 2026-05-30 ~00:45 BST
companion to: ant-v02-identity-and-recovery.md (spec) + ant-v02-cutover-plan.md + ant-v02-post-cutover-runbook.md
---

# Option D Collapse Plan

The v0.2 substrate was built in two parallel agent streams that didn't share a design doc until late in the night. Both streams produced correct work; the names and shapes overlap heavily. JWPK ratified Option D (msg_bby3p17jk6): **adopt the other stream's PRs as v0.2 canonical, drop my prefixed equivalents, and drop the `v02_` prefix entirely since archive-and-ditch eliminates the need for a migration window**.

This doc is the operational contract for the collapse work — what changes, in what order, with what verification.

## §1 The two streams' work

**Other stream (already merged or ready for main):**
| PR | Branch | Provides |
|---|---|---|
| #98 | `feat/stage-a-403-payload` | Restructured 403 PermissionDenied payload (substrate primitive for the modal flow) |
| #99 | `feat/identity-keys-multi-device` | `identities` + `identity_keys` + `identity_attestations` + `recovery_grants` + `identityKeysStore.ts` + `ed25519` sign/verify + paper-mnemonic mandate + 3-tier recovery + attest-device/attest-challenge endpoints + `ant identity` CLI verbs |
| #105 | (stacks on #98) | `permission_requests` + `pending_actions` tables + `permissionRequestsStore.ts` + 5 HTTP endpoints + `ant request approve\|deny\|list\|show` CLI verb + cron TTL sweep |
| #106 | `feat/super-admin-reclaim-v0.2-substrate` | `reclaim_requests` table + `reclaimRequestsStore.ts` + 5 HTTP endpoints + `ant reclaim file/list/show/execute/deny` CLI verb + rich target_kind enum (terminal/membership/identity/session) |

**My stream (to be collapsed):**
| PR | Branch | Was providing | Disposition |
|---|---|---|---|
| #94 | `fix/pid-start-iso-normalisation` | ISO 8601 pid_start normalisation | **KEEP** — independent fix to main |
| #95 | `chore/v02-regression-corpus-skeleton` | 9 todo() regression stubs | **KEEP** — independent skeleton |
| #96 | `fix/auto-rebind-on-register` | Auto-rebind room_memberships on register | **KEEP** — independent fix to main |
| #97 | `docs/v02-spec-concept-doc` | Spec doc + runbook + addendum + this doc | **KEEP** — independent doc work |
| #100 | (closed) | super-admin reclaim duplicate | **CLOSED 2026-05-30** in favour of PR #106 |
| #103 | `feat/v0.2-schema-tables` | 11 `v02_` tables | **REBASE** — drop the 4 duplicate tables + rename remaining to drop prefix (see §3) |
| #104 | `docs/v0.2-cutover-plan` | Cut-over execution plan | **REBASE** — update table refs to unprefixed names |
| #107 | `feat/v0.2-cutover` | v02 substrate stores | **REBASE** — rename stores + retarget unprefixed table names |
| #108 | `feat/v0.2-cutover-m9b-identity-endpoints` | Identity endpoint flips + auto-bootstrap | **REBASE** — same |
| (M9c) | `feat/v0.2-cutover-m9c-chat-rooms` | Chat-room endpoint flips | **REBASE** when it lands |

## §2 Canonical v0.2 table set (post-collapse)

Adopt these names. No `v02_` prefix. New table = name; legacy table keeps its existing descriptive prefix (`chat_rooms`, `room_memberships`, `chat_room_members`, `terminals`, `terminal_records`).

| Table | Source | Purpose |
|---|---|---|
| `agents` | mine (was `v02_agents`), rebased | Durable identity |
| `identities` | PR #99 (already canonical) | Cryptographic identity attestation surface — JWPK to confirm: is `identities` the same as `agents` or a separate concept? See §6 open question. |
| `identity_keys` | PR #99 | Multi-key per identity (ed25519, paper, device) |
| `identity_attestations` | PR #99 | Signed attestation records |
| `recovery_grants` | PR #99 | Tier 2 recovery (super-admin override) |
| `runtimes` | mine (was `v02_runtimes`), rebased | Ephemeral pane binding with `pid_start_iso` |
| `rooms` | mine (was `v02_rooms`), rebased | Persistent coordination spaces with `entry_policy_json` |
| `memberships` | mine (was `v02_memberships`), rebased | Single roster + fanout table, no cached `fanout_target_runtime_id` |
| `tool_grants` | mine (was `v02_tool_grants`), rebased | Issued capability rows |
| `permission_requests` | PR #105 | Modal-popping primitive |
| `pending_actions` | PR #105 | TTL'd action payload queue |
| `reclaim_requests` | PR #106 | Reclaim primitive with rich target_kind enum |
| `audit_events` | mine (was `v02_audit_events`), rebased | Single append-only typed log |
| `user_room_preferences` | mine, rebased | Per-user starred/ordering/last-read (spec addendum from msg_mechnlg9hi) |
| `user_panel_pins` | mine, rebased | Right-hand panel pin set (spec addendum) |

**Dropped (already gone from PR #107):**
- `v02_agent_trust_keys` — superseded by PR #99 `identity_keys`
- `v02_key_rotation_requests` — superseded by PR #99 `recovery_grants`

**Newly dropped (this collapse):**
- `v02_permission_requests` — superseded by PR #105 `permission_requests`
- `v02_pending_actions` — superseded by PR #105 `pending_actions`
- `v02_reclaim_requests` — superseded by PR #106 `reclaim_requests`

## §3 Rebase execution sequence

Do in this order. Each step has its own verification gate.

### Step 1 — PR #103 rebase (drop duplicates + rename remaining)
- Drop `CREATE TABLE v02_permission_requests`, `v02_pending_actions`, `v02_reclaim_requests` from `V02_SCHEMA_DDL_STATEMENTS` in `src/lib/server/db.ts`.
- Rename in DDL strings: `v02_agents` → `agents`, `v02_runtimes` → `runtimes`, `v02_rooms` → `rooms`, `v02_memberships` → `memberships`, `v02_tool_grants` → `tool_grants`, `v02_audit_events` → `audit_events`.
- Rename the constant from `V02_SCHEMA_DDL_STATEMENTS` to `V02_SCHEMA_DDL_STATEMENTS_UNPREFIXED` (or whatever; cosmetic).
- Update `src/lib/server/v02-schema.test.ts` to query the new unprefixed names.
- Update `agents.primary_trust_key_id` FK from any v02_ ref to `identity_keys(key_id)` (PR #99).
- Verify: `bun x vitest run src/lib/server/v02-schema.test.ts` green.

### Step 2 — PR #107 rebase (rename stores + retarget tables)
- Rename `v02AgentsStore.ts` → `agentsStore.ts` (or keep filename + rename only the exported functions). Decide on naming convention; my preference: keep filename `v02AgentsStore.ts` for the duration of the cut-over so call sites are easy to grep, drop the file rename to a follow-up after M11.
- Same for `v02RuntimesStore.ts` and `v02MembershipsStore.ts`.
- Update SQL inside each store to target unprefixed table names.
- Verify: `bun x vitest run src/lib/server/v02*Store.test.ts` — all 37 still pass.

### Step 3 — PR #108 rebase (identity endpoint flip)
- Update register endpoint's dual-write target tables (still write to legacy + new but new is now unprefixed).
- Update resolve endpoint's sidecar lookup.
- Update `v02RegisterBootstrap.ts` to insert into `agents` not `v02_agents`.
- Verify: `bun x vitest run src/routes/api/identity/` — all pass.

### Step 4 — PR #103 add new tables for this scope
- `user_room_preferences` + `user_panel_pins` (added to spec via PR #97 addendum).
- Add to `V02_SCHEMA_DDL_STATEMENTS_UNPREFIXED`.
- Add tests to `v02-schema.test.ts`.

### Step 5 — M9c rebase (when it lands)
- Same shape as Step 3 — update endpoint flips to consume unprefixed table names + store paths.
- Verify chat-room test suite green.

### Step 6 — Cut-over plan doc update (PR #104)
- Update table refs throughout `ant-v02-cutover-plan.md` from `v02_X` to `X`.
- One-commit cosmetic fix.

## §4 Verification gate

Before any of the rebased PRs merge:
- Each `v02_X` name appears nowhere in code or migrations (`grep -r "v02_" src/ scripts/ docs/` returns only this collapse-plan doc, PR #97 addendum doc, capability-ledger historical rows)
- All v02 store tests (37 from PR #107) still green
- All identity tests (116 from PR #108) still green
- All chat-room tests (from M9c) still green
- `bun run check` clean

## §5 Audit trail

This collapse is itself a v0.2-readiness signal — every PR's diff is the renaming, and the diff line count is a forensic record of "how much code was using which name when". Each rebase commit message should cite this doc + JWPK msg_bby3p17jk6 as the trigger.

## §6 Open question for JWPK (not blocking — proceed with §3 in parallel)

**Are `identities` (PR #99) and `agents` (mine) the same concept, or two distinct tables?**

- Option a — **Same**: drop my `agents`, use `identities` everywhere. `agents.kind` becomes `identities.kind` (PR #99 already has the column). My v02_agents code is wholly redundant.
- Option b — **Distinct**: `identities` is the cryptographic-identity surface (signing keys, attestations); `agents` is the substrate-identity surface (kind, display_name, current_runtime_id, owner_org). FK from `agents.identity_id` to `identities.identity_id`. Two tables, clean separation of concerns.

I lean (a) — saves a table, simpler model, less duplication. But (b) cleanly separates "who you cryptographically are" from "what you do in the substrate", which is a real-world distinction (an org could have multiple agents under one human's identity, for example). JWPK to ratify.

If (a) ratified: drop `agents` from §3 Step 1, replace every reference to `agents` in subsequent steps with `identities`.

## §7 Time estimate

- Steps 1-3 (substrate rebase): ~1.5h via one focused agent
- Step 4 (new tables): ~30min, can fold into Step 1
- Step 5 (M9c rebase): ~30min, blocked on M9c landing
- Step 6 (doc cosmetic): ~5min

Total: ~2-3h once M9c lands, fully unblocked.

## §8 Rollback

The collapse is itself just renames + table drops. If any rebase introduces a problem:
- Revert the specific PR (each rebase is one commit per PR)
- Legacy stores untouched throughout; server reading from legacy is unaffected
- PR #98/#99/#105/#106 from the other stream are independent — they merge or stay open regardless of my rebase state
