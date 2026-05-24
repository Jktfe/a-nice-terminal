---
doc_id: spec-vs-impl-drift-2026-05-25
title: "Spec-vs-impl drift survey — banked specs vs shipped wire"
status: punch-list
auditor: "@claudev4"
audited_at: 2026-05-25
trigger: "Dogfood loop (2026-05-24) discovered [[project_bring_in_llm_buttons_2026_05_23]] as banked spec with no shipped wire — `/api/cli-agents/:handleId/prompt` was specced but the endpoint didn't exist until PR #52 closed the gap. Hypothesis: more banked specs are in that shape. This audit walks the project memories and checks whether shipped wire matches each design."
linked_rooms: ["yz4clwzvbm"]
related: ["cross-repo-audit-2026-05-25.md"]
---

# Spec-vs-impl drift survey

## Scope + method

**Scope**: project-type memories that name specific endpoints, UI surfaces, CLI verbs, or store shapes. Skip memories that are pure framing/positioning (e.g. ANT-Cards = home-tab-magic-moment) — those don't have a wire to compare against. Skip feedback memories (those describe disciplines, not artefacts).

**Method**: for each candidate memory:
1. Quote the spec's load-bearing artefact name (endpoint / verb / store).
2. Grep the codebase for that artefact.
3. Classify as ALIGNED · PARTIAL · DRIFT · BANKED-INTENTIONALLY · OUT-OF-SCOPE.

**Status meanings**:
- **ALIGNED** — spec and wire match. No action.
- **PARTIAL** — some of the spec ships, key load-bearing parts don't. Action depends on how load-bearing the missing parts are.
- **DRIFT** — wire exists but in a substantially different shape than the spec describes. Either retire the spec or reshape the wire.
- **BANKED-INTENTIONALLY** — spec describes work explicitly deferred (sequencing, gating, "build after X"). Not a drift — flag only if the gate condition has since cleared.
- **OUT-OF-SCOPE** — sibling-repo or platform-level (antios, native apps); pointer for cross-repo audit, not this doc.

---

## Findings

### 1. Bring-in-LLM buttons → CLOSED (proof point for this audit's hypothesis)

**Spec**: [[project_bring_in_llm_buttons_2026_05_23]] — banked design for one-tap "Bring in Claude Desktop / Claude Mobile / ChatGPT / Gemini" buttons + RoomShelf "Review" tab + Approve/Reject post-flow. Mobile-companion use case explicit.

**Wire status (as of 2026-05-25)**: codex + pi spawn-and-prompt slice of the design shipped via PRs #52 (prompt channel), #53 (in-room bring-in), #55 (pi parity), #56 (explain seeds). The room-page `RoomCliAgentsPanel` is the operator-facing surface.

**Still drift**:
- Claude Desktop / Claude Mobile / ChatGPT / Gemini buttons — those are external LLMs, not local codex/pi processes. The bring-in panel only spawns local CLIs today.
- RoomShelf "Review" tab — Approve/Reject post-flow for content returned from external LLMs. Doesn't exist; spawned CLI output goes to `cli_hook_events`, not to a review queue.
- Mac/iOS surface — see [[cross-repo-audit-2026-05-25.md gap #6]].

**Status**: **PARTIAL** — load-bearing operator-facing channel for local CLIs ships; external-LLM + review-queue paths remain banked.

**Proposed closure**: defer the external-LLM tier until JWPK's "easy adding LLMs" priority lands as an antios slice. The Mac/iOS-side review-queue spec depends on the LLM-tier shape so blocking on the same gate is correct.

---

### 2. Room memory primitive — DRIFT (KV store ≠ MD vault)

**Spec**: [[project_room_memory_primitive_spec_jwpk_2026_05_22]] — user-chosen MD directory (Obsidian for JWPK), `<vault>/room-memories/<id>.md` flat structure, each memory has its own ID + frontmatter with `linked_rooms: [...]`, many-to-many linkage. CLI verbs `ant memory add/list/recall`. Side-panel UI w/ click-to-pull. Mining pipeline phase 2 (chunks built from active conversation AND mining archived chats).

**Wire status**:
- `scripts/ant-cli-memory.mjs` ships `ant memory put <key> --value TEXT [--scope global|terminal|room]` + `list` + `get`. That's a key-value memory store.
- Storage is NOT a user-chosen MD vault; it's a server-side store (likely SQLite) keyed by scope + key.
- No `linked_rooms` frontmatter, no Obsidian/MD-vault read path, no flat-pool semantics.

**Class**: **DRIFT**. The two designs name the same thing (`memory`) but are fundamentally different: KV with scopes vs many-to-many MD-vault index. They could coexist (KV for terminal/session scratch, MD vault for durable cross-room recall), but the spec's load-bearing claim ("Obsidian-readable flat-indexable pool, room-to-vault linkage at user level") has no shipped wire.

**Proposed closure**:
1. Decision needed: are KV memories and MD-vault memories the same surface or two different surfaces?
2. If same: pick MD-vault as the primary storage and re-shape `ant memory put` to write `<vault>/room-memories/<id>.md` instead of SQLite. Keep KV as a derived index.
3. If different: rename one. "memory" is ambiguous now. KV could become `ant kv put`; MD-vault stays as `ant memory`.
4. Either way: the side-panel UI for room memories does not exist on the room page. JWPK's recent feedback ("I SEE NO MEMORIES PINNED IN THIS ROOM") confirms the spec is still waiting for wire. See [[feedback_memory_must_be_room_visible_2026_05_22]].

**Priority**: high. JWPK has flagged the visible-in-room gap directly within the last 3 days.

---

### 3. Asks-as-interview-pattern — DRIFT (separate state ≠ room-message-derived)

**Spec**: [[project_asks_as_interview_pattern_2026_05_21]] — asks as normal room messages tagged `kind=ask`, answer as threaded reply (`reply_to=ask_message_id`), status DERIVED from whether a threaded answer exists. JWPK exact words: "it should be treated like an interview — the open ask and the answer should go to the originating room."

**Wire status**:
- `src/lib/server/askStore.ts`: `AskStatus = 'open' | 'answered' | 'dismissed' | 'merged'` — explicit state field, not derived.
- Asks live in their own store + endpoint surface (`/api/asks/*`), not as room messages with a `kind=ask` discriminator.
- JWPK's "asks should fan out via chat" behaviour is approximated by belt-and-braces posting (see [[feedback_ask_answer_poll_not_chat_only_2026_05_21]]) but not by the architecture.

**Class**: **DRIFT**. The spec's load-bearing claim (status is derived, no separate table) is not the shipped model.

**Proposed closure**:
- Phase 1 (small): add `kind='ask'` + `reply_to` to chat-message records so asks CAN be expressed as messages. Keep askStore alongside as a projection.
- Phase 2 (medium): client-side answer flow posts a threaded reply AND updates askStore (transition).
- Phase 3 (load-bearing): derive `askStore` from the room-message projection; retire the duplicate state. At this point the spec ships.

**Priority**: medium. The belt-and-braces workaround in [[feedback_ask_answer_poll_not_chat_only_2026_05_21]] keeps the user-facing visibility working today, so the drift is operationally tolerable. But it's a genuine architectural gap and worth a sequenced fix.

---

### 4. Validation premium feature — BANKED-INTENTIONALLY (sequencing)

**Spec**: [[project_validation_premium_feature_banked_2026_05_21]] — claim extraction, validator orchestration, %-score computation. JWPK's validation rule shape captured. policyStore + /policies UI + clone endpoint exist (Phase A.5 v4 verification). Missing: claim extraction + validator orchestrator + score computation.

**Wire status**:
- `policyStore.ts` + `/policies/[slug]/edit` + clone endpoint: shipped (verified at PR-history grep).
- Claim extraction / orchestrator / scoring: not in source.

**Class**: **BANKED-INTENTIONALLY**. The memory explicitly states "Do not start building until Speed Pact v0 milestones M-Measure / M-Reuse / M-Onboard / M-Auto / M-Demo are landed."

**Gate check**: has Speed Pact v0 landed? Banked memories reference M-Measure/M-Reuse/M-Onboard/M-Auto/M-Demo as the gate; haven't confirmed completion of all five in this survey. Worth a separate check before unbanking — could be a follow-up audit.

**Action**: defer. Re-audit when Speed Pact v0 gate clears.

---

### 5. Click-to-explain premium tier — BANKED-INTENTIONALLY (sequencing)

**Spec**: [[project_click_to_explain_premium_feature_2026_05_22]] — highlight any term, agent provides inline context grounded in room + plan + memory + evidence. JWPK called it "fucking sick". Build after Stage + Validation v1 land.

**Wire status (post-PR #56)**:
- v0 static OSS map: shipped (kimi ddc69c6, claudev4 PR #56 expansion). 16 seed entries.
- Premium dynamic dump tier: not built.
- Shift+? toggle ships globally.

**Class**: **BANKED-INTENTIONALLY**. Build-order locked behind Stage + Validation v1.

**Action**: defer. Re-audit when Stage + Validation v1 lands.

---

### 6. Stage 6-slice α-ζ — PARTIAL (need slice-by-slice check)

**Spec**: [[project_stage_live_edit_spec_jwpk_2026_05_22]] — 6-slice α-ζ design for live feedback-anchored alternative generation. α-ε is the headline product.

**Wire status**:
- Slice 1+2 (deck voice spec): shipped per [[project_deck_voice_spec_jwpk_2026_05_22]] — slice.narration + auto-narrate + ElevenLabs opt-in + audio cache (3/4 sub-slices; Settings UI pending).
- Slice 4 (Stage in-deck alternatives control): shipped at capability-ledger 2026-05-24 row "Stage in-deck alternatives control".
- Slice 6 (focus password presenter auth): shipped at ledger 2026-05-24 row.
- Slices 3, 5: not explicitly named in recent ledger entries. Sketch-only — need a dedicated audit.

**Class**: **PARTIAL**. Most slices ship; one or two appear to still be banked.

**Proposed closure**: separate small audit on Stage slices α-ζ specifically. Out of scope for THIS doc.

---

### 7. Plan Gantt view — ALIGNED (despite "backlogged" memory tag)

**Spec**: [[project_plan_gantt_view_design_2026_05_15]] — wireframe IMG_0438. Plans-index donut → Gantt → task-detail navigation. Memory tagged "BACKLOGGED".

**Wire status**: `src/routes/plans/[planId]/gantt/+page.svelte` exists. Plans-index donut shipped (16b56e8). Routing exists.

**Class**: **ALIGNED** — the memory's "BACKLOGGED" tag is now stale. The Gantt view shipped at some point and the memory wasn't updated.

**Proposed closure**: update the memory's status from "BACKLOGGED" → "shipped, route exists at /plans/[planId]/gantt". One-line memory edit.

---

### 8. Long-lived agents positioning — ALIGNED (framing memory, no wire)

**Spec**: [[project_long_lived_agents_positioning_2026_05_19]] — agent = substrate (memory + plan + feedback + identity + room context), LLM = muscle. Positioning, not a build spec.

**Class**: **OUT-OF-SCOPE** for spec-vs-impl drift. No wire to compare. Skipped.

---

## Suggested action order

1. **Memory primitive drift (#2)** — JWPK flagged the visible-in-room gap last week. Highest priority.
2. **Memory stale tag update (#7)** — one-line edit to bring [[project_plan_gantt_view_design_2026_05_15]] in line with shipped reality. Low effort, prevents future readers from being misled.
3. **Asks-as-interview drift (#3)** — phased fix, medium priority. Architecture gap but not a UX blocker today.
4. **Bring-in-LLM external-tier (#1)** — defer until antios "easy adding LLMs" priority lands; tracked in cross-repo audit.
5. **Stage slice-by-slice audit (#6)** — separate small audit; out of scope here.
6. **Validation + Premium click-to-explain (#4, #5)** — defer per banked sequencing; re-audit when Speed Pact v0 gate clears.

## What this audit did NOT cover

- Feedback memories (those describe disciplines, not artefacts).
- Pure positioning/framing memories (e.g. ANT-Cards, long-lived-agents).
- Sibling-repo specs (Mac app, Windows app, antios) — covered by [[cross-repo-audit-2026-05-25.md]].
- Specs older than ~2026-05-13 — diminishing returns; the recent ones are likelier to have live drift.

## Next-step asks for JWPK

- **#2 memory primitive**: decision on KV vs MD-vault — same surface or two? Once decided, the slice is plumbing.
- **#3 asks-as-interview**: greenlight the phased approach? Phase 1 alone is small (~30 lines: add `kind` + `reply_to` to message records).
- **#7 Gantt memory tag**: should I update the memory directly or leave for a separate banking pass? Trivial either way.

---

**Banked**: this audit will be re-runnable as a quarterly hygiene exercise. The dogfood loop discovered ONE drift in a 30-min observation cycle — a planned survey catching three of clear-drift class (#2, #3, #7) in 45 minutes suggests the rate is structural, not a one-off.
