<!--
  ANT Programme — canonical artefact per James directive 2026-05-12 (EvoluteAnt
  interview MkZb7Rs5UaF4WeTCB8NPt + ANT-system interview summary).

  Purpose: replace scattered room-chatter status with a single source of truth
  tracking scope, directives, sequence, accepted baselines, active slices,
  deferred items, and QA gates.

  Future claim-first messages can reference relevant section anchor IDs from
  this file when useful for reviewer context. This document records existing
  process state and reviewer practice; it does not invent new mandatory gates
  beyond what reviewers already enforce.
-->

# ANT Programme

Last updated: 2026-05-12.

---

## Scope

**Locked scope sentence (James-bound, evolveantcodex-affirmed):**

> ANT is **transport + evidence + render-progress + keep-evidence-readable**.

Reject any drift where ANT decides for the operator instead of displaying evidence to them. This applies to routing, billing, model choice, hidden automation, or rebuilt companion products.

Routing applies to MESSAGES (handoff between agents/rooms/terminals), not models. Model selection sits outside ANT.

---

## Directives

All directives below originate from James and are dated to the EvoluteAnt session they were captured in.

### D1 — Chair stays, renamed, optional (2026-05-12)
Rename Chairman → Chair across all surfaces (no gendered terminology). Chair stays as a function but is **optional with clear settings toggle**. Core flows (rooms, messages, asks, focus) must boot when Chair is disabled.

### D2 — No model routing in ANT (2026-05-12)
Model routing is mymatedave's lane, not ANT. All routing-decision stores/components/routes/APIs are out of scope. Display-only agent model/cost evidence is retained for now pending future James confirmation on its rename/removal.

### D3 — No usage-tracking rebuild (2026-05-12)
Do not clone OpenUsage. Recommend OpenUsage as a companion. Future plug-in display-only, never in-tree.

### D4 — Plug-in ecosystem (2026-05-12)
Settings panel lists recommended companions: Obsidian, OpenUsage, Open-Slide, Flowdeck, FlowSpec, Pencil, plus future additions. ANT reads from their interfaces where integration exists; otherwise shows a recommendation card. **Zero in-tree clones.**

### D4a — Obsidian shared-pool (2026-05-12)
Optional Obsidian vault path in settings. Empty by default → no shared pool, ANT still works. When set, ANT scans the vault for skills/memories/tools/plug-ins and makes inventory accessible to all agents in the session. **Never forced** — agents may pull from the pool or not. ANT does not interpret or route based on pool contents.

### D5 — Terminal fingerprinting M-FINGER (2026-05-12)
Three-slice feature. User picks a shortcut intent + enters a CLI command. ANT opens a **VISIBLE** test-terminal pane (side panel or modal — never background). Initial audit detects hooks/skills/tools/status-line. Suggestions surface inline + skippable. Per-terminal surface contract answered while terminal is visible (show "thinking"? pull status line? what to ignore? what to capture? what stays raw?). Saved as named fingerprint, invokable later as shortcut.

### D6 — Message rendering M-MSGRENDER (2026-05-12)
Detect-and-render tables (regex), markdown structures, plan blocks coming through from terminal output. Match visual quality of legacy ANT. Three-slice sketch: tables → markdown body → plan cards.

### D7 — Agent mode/state surfacing (2026-05-12)
UI surfaces each agent's operational mode: auto-accept edits, auto, plan, chat, read-only/review, approval-required, sandbox/permission state, future driver-specific flags. Tied to M-FINGER (different CLIs expose different state signals; fingerprint declares which signals to capture).

### D8 — Message receipt/thinking-state (2026-05-12)
After a user submits, UI shows received → acknowledged → thinking-working → drafting → blocked states. **Interview channel is the priority** (the channel James currently uses; current UX is opaque post-submit). General chat receipts ship second.

### D9 — In-terminal linked-chat default (2026-05-12)
Agent-to-agent conversation defaults to the terminal viewport via linked-chat, not a separate chatroom. Original pattern restored: "go ask @xxx" navigates to xxx's terminal where the conversation lives. Separate-room creation becomes an option for genuinely multi-party scenarios, not the default for 1-on-1.

### D10 — Cross-agent terminal inhabitation (2026-05-12)
Any agent can inhabit another agent's terminal: read current state + history + linked-chats AND interact via a CLI for the terminal stream. Includes verify-spawn-then-interact pattern: when an agent is spawned, the spawning agent follows the boot, detects stuck-state (Pi node version mismatch, env oddity, etc.), and unsticks via CLI commands against the new terminal. Render-only never decide.

### D11 — Visual slash command menu (2026-05-12)
Typing "/" surfaces a discoverable menu of available commands for the current terminal/agent/mode (command-palette style). Discoverability layer over the CLI verb library.

### D12 — Message claim states + conversation modes (2026-05-12)
Three per-message claim states agents can ping back: **seen** (receipt), **on it** (working), **locked** (exclusive). Per-room conversation mode toggle: **Brainstorming** (open, multi-agent response welcomed) vs **Delivery** (server cycles message through registered participants one at a time; passes only if current is busy or asks "leave open" / "want another opinion"). Race resolution: claim-transparent (visible to all) over hide-when-read so D10 look-over-shoulder is preserved. D12a task-complexity gating: trivial mechanical asks override Brainstorming with one-agent routing; sender-tags-the-message proposal awaiting James pick.

### D13 — tfeSvelteTemplates as canonical Svelte library for plug-in development (2026-05-12)
ANT recommends tfeSvelteTemplates (by James King) through the M-PLUGINS settings panel as the canonical Svelte library for plug-in development. ANT itself becomes a showcase. Attribution included in recommendation cards alongside Obsidian/OpenUsage/Open-Slide/Flowdeck/FlowSpec/Pencil. Treated like all plug-ins: external, not in-tree.

---

## Sequence

Ordered by current intent. James reshuffle welcome.

1. **Router-revert slice 1** — `ACCEPTED BASELINE` 2026-05-12.
2. **PROGRAMME.md artefact** — `ACCEPTED BASELINE` 2026-05-12.
3. **Chair-rename slice 2a** — `ACCEPTED BASELINE` 2026-05-12 (mechanical rename).
4. **Chair-rename slice 2b** — `QUEUED` (optionality settings toggle + guardrail test).
5. **ModelRoutingPolicy → AgentModel rename** — `QUEUED` (closes deferred item; "only routing is messaging" clarification).
6. **D9 in-terminal linked-chat default** — `QUEUED`.
7. **D10 cross-agent terminal inhabitation** — `QUEUED` (includes verify-spawn-and-interact).
8. **D11 visual slash command menu** — `QUEUED`.
9. **D12 claim states + Brainstorming/Delivery modes** — `QUEUED` (incl D12a task-complexity gating, sender-tags proposal awaiting James pick).
10. **D13 tfeSvelteTemplates as canonical Svelte lib** — `QUEUED` (folds into M-PLUGINS).
11. **M-PLUGINS** — settings UI: recommended-companions list + Obsidian shared-pool vault picker + read-only inventory.
12. **M-FINGER slice 1** — settings UI + named-shortcut entry + visible test-terminal pane primitive.
13. **M-FINGER slice 2** — initial-audit walkthrough (hook/skill/tool/status-line detection).
14. **M-FINGER slice 3** — per-terminal surface contract (show/ignore/capture/raw) + save+invoke.
15. **M-MSGRENDER slice 1** — table detector + table renderer.
16. **M-MSGRENDER slice 2** — markdown body (headings/lists/inline code/links/fenced code).
17. **M-MSGRENDER slice 3** — plan block detector + visual plan card.
18. **Mode-surfacing** — agent mode/state badges; ties into M-FINGER signals.
19. **Receipts** — interview-channel receipt/thinking states first, then chat.

---

## Accepted Baselines

### This cycle (2026-05-12)

- **M29 slice 4a** — LLM writer hook seam (chairmanStore accepts cheap-model summaries; conditional render in ChairmanRow).
- **Draft persistence backend slice 1** — per-room/per-author drafts; 4 new files + B1 blank-handle patch.
- **M30 slice 3e** — reply-count badge (`N↳`) on parent rows with aria-label.
- **M29 slice 4b** — LLM summary push endpoint (PUT/DELETE `/api/chairman/[roomId]/llm-summary`).
- **R4** — `+error.svelte` branded room-not-found page with `role="alert"` + back-to-rooms link.
- **Router-revert slice 1** — M28 routing OUT of ANT scope by JWPK directive. 17 files deleted + `+page.svelte` surgery + 5 comment-header cleanups + `docs/model-routing-contract.md` deletion + B1 tail patch. ~1000 LOC net deletion. Display-only `ModelRoutingPolicy` metadata retained as documented.
- **PROGRAMME.md artefact** — canonical programme doc, accepted 2026-05-12. This slice updates that artefact in place.
- **Chair-rename slice 2a** — Chairman → Chair mechanical rename. 7 file renames + 2 directory renames; 0 chairman hits in src/ post-slice; old `/chairman` + `/api/chairman` paths intentionally 404 per no-redirect contract; PROGRAMME.md historical mentions retained as dated audit only.

### Pre-existing baselines (mirrored from /loop args)

M01, M02, M30 (threading slices 1+2+3a+3b+3c+3d+3e), M12, M03 (slices 1-5 + slice 4.1), M13, M31, M28 (all 4 slices — **note: now REMOVED by D2 directive; recorded historically here, no longer active in code**), M29 (slices 1-4a + 4b + asks-summary chairman digest), M19 backend + UI slice 2, M16 slices 1-2, M14, M11 (all 3 slices), M17 backend + UI slice 2, M24 backend + UI slice 2, memory-recall slices 1-10, asks slices 1+2+3, M22 slice 2.

---

## Active Slices

- **PROGRAMME.md UPDATE slice** (this slice) — in-flight, evolveantcodex-approved boundary.
- **Focus Mode backend slice 1** (claude2 shipped) — kimi security PASS; awaiting evolveantcodex full boundary review for baseline promote.
- **R5 rooms-list empty-state** (claude2) — awaiting final approval tail.
- **R6 + R8 + R10 a11y bundle** (glm) — pending full claim-first resubmit.

---

## Deferred Items

- **M20 B1 asHandle session-handle gap** — kimi M20 audit found `@you` hardcoded across ChatComposer/MessageList/MessageRow/MessageReadIndicator. Needs identity primitive slice with localStorage handle picker.
- **R7 InviteAgentForm state split** — cap-sensitive at 255/260; needs split-first plan.

---

## QA Gates

Standard evidence reviewers commonly request when assessing a slice. Order can vary by what the slice touches; reviewers ask for whichever signals are relevant.

- **`bun run check`** — `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`. Reviewers typically expect 0 errors / 0 warnings.
- **`bun run test`** — full Vitest suite. Reviewers typically expect all tests passing.
- **`bun run build`** — production build green.
- **`node scripts/check-component-lines.mjs`** — Svelte files under 260 lines (cap currently measured via `split("\n").length`).
- **Claim-first message** — file boundary (NEW/DELETE/EDIT with line counts), line-count risk, overlap with other lanes, and a test+evidence plan; reviewers ACK the boundary before edits begin. Expansion is by amendment in practice.
- **CLI-parity rule** (binding policy, 2026-05-12) — every UI action surface also exposes a CLI verb. CLI is the primary verb library; visual menus are discoverability layers over CLI. Recorded as a James-locked policy, not an ANT-invented gate.

### Destructive-delete guidance (specific high-risk case)

For slices that delete shipped or in-flight files, the recent router-revert review converged on these practices:

- Run a residual-refs grep covering both term names AND **route paths** (e.g., `/foo` references in comments) before declaring the slice ready.
- If residuals fall outside the approved boundary, prefer halting and posting a BLOCKER-on-own-slice with amendment options over silently expanding.
- Slice-ready evidence reads cleaner when it includes `git diff --stat` plus an explicit deleted-file list, with a note for any untracked-new files that were deleted (those leave no git footprint).
- A CHANGELOG-style audit-note naming the directive helps the reviewer trace why deletion happened.

These are not universal preconditions for every slice — they are what made the router-revert review smooth and are worth reaching for when the surface deletes shipped code.

---

## Supporting Audit Passes

Read-only audits that did not become baselines themselves but supported other work:

- **kimi Focus Mode security audit** (2026-05-12) — 3 PASS + 1 NOTE (DELETE membership-independent idempotency, accepted).
- **codex2 M30 threading regression sweep** (2026-05-12) — slices 3a-3e all green together; 650/650 at the time of the sweep.
- **codex2 router-revert PASS + B1 re-pass** (2026-05-12) — initial amended-boundary PASS, B1 cleanup tail re-PASS after 2 stale `/routing` comment-ref patches.
- **codex2 Chair-rename 2a PASS with full route smoke** (2026-05-12) — verified `/chair` + `/api/chair` return 200 (incl notes + llm-summary nested), old `/chairman` + `/api/chairman` 404 per no-redirect contract, identifier renames all confirmed, 633/633 tests PASS.
