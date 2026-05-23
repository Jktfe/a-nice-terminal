---
doc_id: speed-pact-v0
title: "Speed Pact v0 — ANT vNext Refactor + Speed Optimisation Contract"
status: DRAFT (awaiting JWPK ratification of Q1-Q4)
authors: [@speedyclaude, @speedykimi, @speedycodex]
created_at: 2026-05-21
room: orsz2321qb (speed matters)
plan: speed-pact-v0 (NOT YET CREATED — R4 hold)
ledger: ./audits/speed-ledger-2026-05-21.md
visibility: oss
---

# Speed Pact v0

Three agents. One mission. Refactor + speed-optimise ANT vNext without breaking things.

## What "fast" means here

JWPK's rule: feel-of-speed is three layers, not one.

1. **ACK latency** — agent confirms within 5 seconds, always. Silence ≠ thinking; silence = lost trust.
2. **Verdict accuracy** — answer is right by the time it lands. Slow + correct beats fast + wrong.
3. **Wall-clock latency** — the actual thing. Attacked last, because layers 1+2 buy headroom to do (3) without breaking things.

A "Working" status that takes 5 seconds to wake is fine. A 30-second action is not. Cadence + accuracy come before raw speed.

## Team

| Lane | Agent | Scope | Verdict the lane owns |
|---|---|---|---|
| **L1 — Measure & Cadence** | @speedyclaude | Baselines, latency budgets, speed-ledger, perceived-speed wins (ACK, skeletons, optimistic UI). | "Is it actually faster?" Cannot ship a speed claim without numbers. |
| **L2 — Reuse & Refactor (expanded)** | @speedykimi | UI tiering (183 components → primitives/container/surface), store consolidation (322 server files → factory + parser-plugin), build/test speed (vitest 30s → <30s, pool=forks → threads where safe). | "Is this reusable? Is it deduped?" |
| **L3 — Onboarding, Tooling, Memory** | @speedycodex | The 20-minute warm-up for non-repo agents, capability manifest, plan/task verb enforcement hooks, Obsidian↔ANT memory wiring. **Coordinator role** (lane arbitration, shared-file safety, evidence gates) pending JWPK bless. | "Does this agent know how to use ANT?" |

## Coordination contract

### R1 — Claim before create
Post `✋ on it [lane] [thing]` in the room within 30 seconds of starting any artefact (plan, doc, file). 30 seconds of coordination beats 10 minutes of dedupe.

### R2 — L2 owns UI + stores together
Component tiering and store consolidation are the same structural problem at two layers (flat directories, no factory). One lane owns both. (Banked: 183 .svelte + 322 .ts files = identical dedupe pattern.)

### R3 — L1 → L2 sequencing
You can't refactor what you haven't measured. L1 publishes Baseline-1 (the 8 metrics in `speed-ledger-2026-05-21.md`) before L2 claims any refactor task. L1 is fast (≤30 min) because Kimi pre-gathered Baseline-0 evidence.

### R4 — Ratification gate
No `ant plan` events. No `ant task create` entries. No repo edits. Until JWPK answers Q1-Q4 below.

Obsidian drafts are reversible and pre-blessed.

### Amendment E — Evidence pre-seeded
Kimi's Baseline-0 table (183 / 322 / 157 / 6× / 8 / 30s / 1.1M / 2.4M / 2.9M) lives in `audits/speed-ledger-2026-05-21.md` as rows 001-009. L1 verifies + adds budget columns. Does not re-measure what's already on disk.

### Amendment F — L2 scope confirmed
L2 explicitly owns UI tiering AND store consolidation AND build/test speed. One lane, one owner, one ledger.

## Cadence rules

- **ACK budget**: 5 seconds. "On it, ETA Xmin" counts.
- **No silent hold**: every wait → open ask with ask_id referenced in chat.
- **2-iter rule**: if JWPK silent for 2 /loop cycles on a non-reversible decision, hold. On reversible, lane owner decides and posts the decision.
- **Pickup ACK** on JWPK ask-answers within one /loop cycle.
- **Asks = JWPK-decisions only**. Agent-to-agent picks live in chat or tasks.
- **Stop flooding @you's input**: agent-to-agent chat stays tight. Reserve large messages and tags for human-gated decision points.

## Speed targets

### Dev-loop budgets (L2)
- Dev server cold start: <3s
- Component HMR p95: <200ms
- Test suite wall time (full): <30s
- Watch-mode single file: <3s
- Agent onboarding (cold → first `ant plan section`): <2min (L3)

### Latency budgets (L1)
- Chat send ack p95: <100ms (server local)
- Room message fanout p95: <500ms
- Plan event materialise p95: <1s
- Terminal capture → first DB append p95: <2s

All targets are L1-measured before they are L2-optimised. No regression without a banked decision event stating the trade-off.

## Attack order

1. **ACK latency** (status updates, progress glyphs, skeletons, optimistic UI) — cheap wins, week 1
2. **Verdict accuracy** (kill races, kill silent-fail, kill ghost rows) — week 2
3. **Wall-clock** (the actual refactor) — week 3+

Reasoning: layers 1+2 buy time to do (3) without breaking things. This is the JWPK 5s/30s rule applied to engineering sequence.

## Anti-patterns — do not repeat

Seeded from MEMORY.md banked feedback. New anti-patterns discovered during this work get banked the same day.

- `$effect`-on-mount for IO → SSR `load` / `onMount`-stable / pure-prop
- Observer on a node you also write to → flag-guard own writes (locks JS thread)
- Page-gate `/api/*` when identity-gated → `hooks.server.ts` bypass all `/api/*`
- Shape-test on external-process subsystems → resolve at test time
- Smoke = re-read body, not curl wire-state → curl PATCH→GET before "ready"
- Posting as @you via admin-bearer → use own handle, always
- Stacking unverified commits → dogfood each commit
- $effect-on-mount-for-IO pattern is banked regression
- Long chat messages containing `--flag` shaped fragments → CLI may re-paste help output (banked 2026-05-21)

## Working rules (from Kimi's v0.1 spine, ratified)

- **Audit-first**: any block copied from a-nice-terminal v1 gets a source path + KEEP/CHANGE/DEDUPE/DEFER/REJECT verdict per AGENTS.md.
- **Component-size gate**: <150 lines per component. Exceeding = split or containerise.
- **Store gate**: any new store must justify why it can't use the generic factory.
- **Agent capability gate**: every new agent kind must ship with a parser + state reader + hook installer, or be deferred.
- **Evidence-before-merge**: `git diff --cached --stat` checked before every commit; no WIP leakage.
- **Memory-first**: every discovery, decision, or rejection gets a memory entry (banked feedback or banked project) + an Obsidian audit note under `audits/` with date + owner.

## Documentation layout (Obsidian = ObsidiANT/)

- `contracts/speed-pact-v0.md` — this contract, ratified version (currently `-DRAFT` until JWPK blesses).
- `audits/speed-ledger-2026-05-21.md` — running ledger of measurements + hypotheses. **Append-only.**
- `audits/<lane>/<finding-id>.md` — one card per finding. Hypothesis, baseline, target, evidence, decision, links to commits/PRs.
- `research/l2-store-audit-2026-05-21.md` — Kimi's L2 inventory + 3 refactor candidates.
- `research/<lane>-<topic>-YYYY-MM-DD.md` — exploratory work, pre-decision.

Naming: `<lane>-<slug>-YYYY-MM-DD.md`. UK English. £ default.

## Memory protocol

- **Bank** when: (a) we kill a long-held assumption, (b) a measurement disproves a fix, (c) JWPK directive lands, (d) a coordination failure happens.
- **Recall** before: (a) any "X exists" claim — verify file/grep first, (b) any proposal that touches a banked-as-locked surface (Direction C v3.3 palette, asks=decisions-only, etc.).
- **Don't bank**: code patterns the repo already shows. Bank what's non-obvious or surprising.

Memory home: `/Users/jamesking/.claude/projects/-Users-jamesking-CascadeProjects-a-nice-terminal/memory/MEMORY.md` (index) + per-topic files.

## Open questions for JWPK (Q1-Q4) — ratification gate

| # | Question | Default if blessed |
|---|---|---|
| Q1 | Lane split: Claude=L1 Measure / Kimi=L2 Reuse-expanded / Codex=L3 Onboarding+Memory+Coord. Bless? | Yes |
| Q2 | Attack order: perceived ACK → verdict accuracy → wall-clock refactor. Bless? | Yes |
| Q3 | Single `speed-pact-v0` plan with 5 milestones (M-Measure / M-Reuse / M-Onboard / M-Auto / M-Demo)? | Single plan |
| Q4 | Ratified contract location: `contracts/speed-pact-v0.md`? | `contracts/` |

## Sign-off

- @speedyclaude — ratified (drafter, L1)
- @speedykimi — ratified (L2)
- @speedycodex — ratified (L3)
- @you (JWPK) — **PENDING** ratification of Q1-Q4

Once JWPK blesses, the `-DRAFT` suffix is removed and the ANT plan + initial tasks are created.

## What happens after ratification (preview, not yet executed)

1. **L3** creates the ANT plan `speed-pact-v0` with 5 milestones via `ant plan section` + `ant plan milestone` events.
2. **L1** runs the 8 Baseline-1 measurements, appends to the ledger, posts measurement_ids in room.
3. **L2** claims first 3 refactor candidates (Generic TranscriptTailWatcher / ModalShell primitive / Store factory) via `ant task create --plan speed-pact-v0`. Each task references the ledger row + the audit card.
4. Demo: weekly cadence check-in showing latency budget compliance, refactor PRs landed, anti-pattern bank growth.
