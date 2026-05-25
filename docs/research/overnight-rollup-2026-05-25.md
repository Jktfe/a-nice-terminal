---
doc_id: overnight-rollup-2026-05-25
title: "Overnight rollup — JWPK morning scan"
audience: "@you"
generated_at: 2026-05-25 01:20 BST
generated_by: "@speedyclaude"
purpose: "single-page rollup so JWPK can scan-read the night's work fast on wake-up"
---

# Overnight rollup (2026-05-24 evening → 2026-05-25 ~01:20 BST)

40 commits on `a-nice-terminal` main + 6 commits across 2 cross-repo PRs (one each on `antchat` Mac + `antchat-windows`). All three lanes JWPK greenlit closed.

## The three lanes (JWPK msg_dnlrvie7y6 "just get going")

### 1. Dogfood spawn (claudev4 → speedyclaude peer-review) — **CLOSED**

claudev4 spawned a codex, hit "can't drive it without an input channel" within 20 min, pivoted to **fixing the dogfood's own blocker**. Six findings + 4 shipped fixes in ~2 hours from spawn to all-fixed-on-main:

| Finding | Status | Commit |
|---|---|---|
| #1 no `ant <verb>` to spawn codex | SHIPPED | ea0ce6a (cli-ergonomics) |
| #2 `ant rooms create` positional vs `--name` | SHIPPED | ea0ce6a |
| #3 success message no next-step nudge | SHIPPED | ea0ce6a |
| #4 codex bring-in not in-room | SHIPPED | e50be61 (RoomCliAgentsPanel) |
| #5 spawn endpoint room-detached | RESOLVED via #4 (room-scoped `/api/chat-rooms/:roomId/cli-agents`) |
| #6 no operator prompt channel | SHIPPED | ff59ee0 (POST /api/cli-agents/:handleId/prompt) |
| bonus: pi parity | SHIPPED | 99fc025 |
| bonus: explain seeds for all of above | SHIPPED | 126ecf0 |

**Premise stress-test produced richer outcome than original "ship slice 5 via spawned codex" framing would have.** The Option A pivot ("fix the blocker that prevents dogfooding") is now banked as a pattern.

### 2. Click-to-explain v0 (speedykimi) — **CLOSED**

`docs/research/click-to-explain-spec-v0.md` (kimi fcf959b) → v0 implementation (56966da) → expansion 11 seeds + Shift+? shortcut (ddc69c6) → CLI-agent seeds (126ecf0).

OSS static map shipped; premium dynamic-from-room-memory deferred per spec (gated on Speed Pact v0).

### 3. Cross-repo audit (speedyclaude) — **WIRE LANDED on a-nice-terminal; sibling-repo PRs OPEN for your review**

`docs/research/cross-repo-audit-2026-05-25.md` identified 5 → 6 gaps between server changes and sibling clients. Status:

- **Gap #1** ChatRoom.description field — wire+UX shipped on antchat Mac (PR #1) + wire on antchat-windows (PR #1).
- **Gap #2** Filter chips polish — banked, polish-tier.
- **Gap #3** AwayMode wire — wire+UX shipped on antchat Mac (PR #1).
- **Gap #4** SSE status pill — deferred (Mac team's real-time strategy needs to converge).
- **Gap #5** Click-to-explain Mac parallel — deferred (waits on web v0 maturation).
- **Gap #6** CLI bring-in mirror — **fresh, not started.** Same shape as #1+#3 but ~80 lines per repo. Holding until you've seen the gap #1+#3 PRs to avoid drift.

## Open PRs awaiting your pull+test

- **antchat #1** — https://github.com/Jktfe/antchat/pull/1 — gap #1 + #3 wire+UX (5 commits, xcodebuild green throughout)
- **antchat-windows #1** — https://github.com/Jktfe/antchat-windows/pull/1 — gap #1 wire (1 commit)

## Banked memories (3 new this overnight)

- `feedback_capability_ledger_required_per_slice_2026_05_24.md` — every src/scripts/ slice needs a `docs/capability-ledger.md` row IN THE SAME COMMIT. Codex blocked twice for missing this; banked after the second.
- `feedback_cross_repo_review_per_slice_2026_05_25.md` — JWPK msg_78mmgq4ge6: every user-facing a-nice-terminal slice must flag sibling-repo candidates in commit body + orsz announcement.
- `feedback_verify_protocol_methods_against_generator_2026_05_25.md` — when wrapping a JSON-RPC or typed-command bridge, read protocol method names off the generator/schema/type source rather than guessing. Hardened twice in one cycle (codex schema generator + pi TS union).

## Standing questions / decisions you can defer

- Gap #6 (CLI bring-in mirror) Mac/Windows — speedyclaude can pick up after you've reviewed gap #1+#3 PRs.
- `feedback_native_module_rebuild_node_version_2026_05_24.md` (banked) — the bun/v26 vs launchd-v22 ABI trap surfaced TWICE today; permanent fix (CI-or-prebuild-checked ABI) deferred but worth a slice eventually.
- Auth-gate latency investigation (`project_auth_gate_latency_investigation_2026_05_24.md`) — 3 safe optimisations shipped (instrumentation 8f2bdfe, accounts-bearer dedup 799fd05, touch debounce 300f468). The next step is **flip `ANT_AUTH_GATE_DEBUG=1` on launchd plist** when you're at terminal, capture 3-21s 401 traces, optimise from data not guesses.

## Diagnostic state

- svelte-check on main: **0 errors / 0 warnings** (clean baseline)
- npm run build green
- Server kickstarted; /api/chat-rooms warm-path 12-17ms
- Both server-hang defences live (root cause SSE backpressure fix + watchdog plist)

## Speed-pact agents

@speedyclaude (me), @speedycodex, @speedykimi, @claudev4 (yz4) all active overnight. No idle speed-pact agents at sign-off. Rooms quiet from ~01:00 BST — natural pause + your sleep.

## What I'd hit first when you wake

1. Pull + smoke the two open cross-repo PRs (5 min each).
2. Pick whether to flip `ANT_AUTH_GATE_DEBUG=1` for the 3-21s 401 traces.
3. Decide whether gap #6 is worth a fresh slice OR if there's higher-priority work surfaced overnight.

— @speedyclaude
