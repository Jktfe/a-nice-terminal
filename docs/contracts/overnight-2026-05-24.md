---
contract_id: overnight-2026-05-24
title: "Overnight 8-hour autonomous delivery brief — 2026-05-23 → 2026-05-24"
status: live
visibility: oss
proposed_by: "@speedyclaude (Chair)"
proposed_at: 2026-05-23
linked_rooms: ["orsz2321qb", "iawcdenlgc", "yz4clwzvbm", "hyz00k0ibh"]
expires_at: 2026-05-24T08:00:00Z
---

# Overnight 8-hour autonomous delivery brief

JWPK directive `msg_8jo1a37blx` (2026-05-23 ~22:00 BST): make sure every agent has access to the protocols + contracts that enable 8 hours of autonomous delivery without his input.

This doc is the **single entry point for overnight self-direction**. If an agent is idle, the answer is in here.

## The 5 protocols every agent must know

1. **Speed Matters governance** — `docs/contracts/speed-matters-governance-v1.md`. Single-peer-ACK merge gate; honest reporting; no force-pushes; no merge without verification.
2. **Room state + away-mode** — `docs/contracts/room-state-away-mode-v1.md`. The away-mode → room-mode mapping; brainstorm = discuss + propose, heads-down = deliver claimed slices, closed = read-only.
3. **Exploration backlog** — `docs/contracts/exploration-backlog.md`. Claim source when bound work blocks. Pull from here rather than idle.
4. **Build-Both pending** — `docs/contracts/build-both-pending.md`. When two valid paths exist and JWPK is unavailable, build both in parallel + park the loser.
5. **SSE consumer contract v0** — `docs/contracts/sse-consumer-contract-v0.md`. Just shipped. The realtime delivery shape; consumer modules build on this.

All 5 are OSS-visible. No agent should claim "I didn't have the protocol".

## The 4 hard rules for the overnight window

1. **Worktree-only** — no direct commits to main. Branch off main, worktree → commit → peer-review → merge.
2. **Single peer-ACK suffices** — author + 1 reviewer = 2 distinct agents. Don't wait for JWPK.
3. **Bank major decisions** — every non-obvious choice gets a memory file or capability-ledger row. "Memory must be room-visible" per banked feedback — also `ant artefact add` if appropriate.
4. **Use asks for genuine decisions only** — if it's a real product call JWPK must make, open an ask. If it's a scope guess, build-both or pick from backlog. The default is keep moving.

## Named claims (as of 2026-05-23 22:00 BST)

| Agent | Next slice | Source |
|---|---|---|
| @speedycodex | M3 typed endorsements (sign-off/ratify/validated as a primitive replacing the 3-4-message ratification chain) | Codex's own build brief msg_22 (`orsz2321qb`) |
| @speedycodex | M4 room-memory rule fold into M-Onboard preamble (alongside context-break + memory-room-only rules already there) | Codex's own build brief; smaller than M3, can ship first if a 30min slot opens |
| @speedykimi | Dual reaction-table cleanup (`chat_message_reactions` orphans vs `message_reactions` real — banked sidenote from M2 verification) OR pick from exploration backlog | Sidenote in `orsz2321qb` (msg_dbmfi2mv8e), exploration-backlog.md |
| @claudev4 | SSE finish-layer module — offline indicator / retry feedback / caught-up UX / unreachable surface — on top of the merged `realtimeRoomConsumer.ts` | Silent heroes ratify (`yz4clwzvbm`) |
| @antchatmacdev / native team | Native-side memory rendering for the room memory bridge codex shipped (`a46a8bb`); RoomShelf Memories tab | Native cross-team room `hyz00k0ibh` last message |
| @speedyclaude (Chair) | Cross-room digest every ~2h; light verify trio commits; dismiss extractor noise; surface real decisions to JWPK via ask | Chair role |

## What to do if your claim is done

1. Mark it done in `docs/capability-ledger.md` 2026-05-23 ship log
2. Post a short ship report to your room with commit SHA + live-verify evidence
3. Pick the NEXT item from your row above. If exhausted, pull from `exploration-backlog.md`.
4. If exploration-backlog is empty too, the right move is **rest, not invent** — surface to Chair via ask before generating work.

## What to do if you're stuck

1. **Read your last 3 cycle posts** — what were you doing? Why did it stall?
2. **Surface the obstacle as logic-shape** in your room (per banked `feedback_surface_obstacle_dont_dump_detail_2026_05_23`): 1-line problem + 2-4 one-line paths + tradeoff per path + "pick which?". Do NOT bulk-dump.
3. **Build-Both if the choice is binary** — parallel worktrees, park the loser, no merge collision.
4. **If genuinely blocked on JWPK input** — open an ask via the primitive, NOT a chat @-tag. Then move to the next backlog item.

## What NOT to do

- Don't go silent for hours expecting "the protocol says don't spam". Silence ≠ delivery; it's the opposite. Banked: `feedback_surface_obstacle_dont_dump_detail_2026_05_23`.
- Don't @-tag JWPK on non-decisions. The ask primitive exists for exactly this.
- Don't push to main directly. Worktree → peer-review → merge. Every time.
- Don't extrapolate from one example to a universal claim. Banked: `feedback_extrapolation_to_universal_claim_2026_05_21`. Check the doc-comment / source of truth before flagging something as broken.
- Don't bypass peer-review for "trivial" changes. The lint of "is this actually trivial?" is the peer's job, not yours.

## How to find anything

- **Recent ships:** `docs/capability-ledger.md` (latest section is the 2026-05-23 Ship Log at the bottom)
- **Banked memories:** the agent-local `/memory/` directory; MEMORY.md is the index (auto-loaded at session start)
- **Open asks:** `GET /api/asks?status=open` or `ant asks list`
- **Active worktrees:** `git worktree list`
- **Room state:** the Room mode + Away-mode toggles on `/rooms/[roomId]` page

## Banked rules to apply tonight

These are the lessons from today's session that should shape every agent's behaviour for the next 8 hours:

- [[feedback_guard_before_action_meta_pattern_2026_05_23]] — the guard belongs before the cost, not after
- [[boundary_surface_invisible_upstream_constraints_2026_05_23]] — boundary-shape failures (500/502/413) need explicit env config + CI smoke tests
- [[feedback_context_break_hard_stop_memory_room_only_2026_05_23]] — context-break is a hard backwards-scan boundary; memories are room-only by default
- [[feedback_no_temporal_anchoring_in_generated_copy_2026_05_23]] — no "tonight" / "this morning" / "today" in generated copy (this brief uses ISO timestamps + commit hashes instead)
- [[feedback_surface_obstacle_dont_dump_detail_2026_05_23]] — 3 one-liners with tradeoffs beats 200 lines of analysis
- [[feedback_containment_not_design_when_fixing_leaks_2026_05_23]] — fail-closed first, redesign second
- [[feedback_extrapolation_to_universal_claim_2026_05_21]] — doc-comment first, probe second
- [[feedback_disappearing_errors_check_for_fix_not_transient_2026_05_23]] — opaque failures often have a recent fix; check `git log --since` before labelling "flake"

## Status reporting cadence

- **Per ship** — short report in originating room with commit SHA + live-verify evidence
- **Per 2h** — Chair (me) posts cross-room digest to `orsz2321qb` showing what landed + what's in flight + what's stuck
- **At 8 hours (Sat 2026-05-24 06:00 BST)** — single consolidated digest pinned in `orsz2321qb` for JWPK's morning check

## Expiry

This brief expires `2026-05-24T08:00:00Z`. After that, JWPK's morning direction supersedes whatever's here.

## Cross-references

- This doc was authored after JWPK's two consecutive directives `msg_d1ahaarsit` (cross-room coordinate) + `msg_8jo1a37blx` (protocol access for 8h autonomous delivery)
- All linked contracts above are OSS-visible from `docs/contracts/`
- The premium-visibility companion contracts (overnight-agent-delivery-v1, build-both-pivot-pattern, ant-stage-protocol-v0) live in the antchat resources bundle — operational guidance from those is already reflected in the OSS contracts named above
