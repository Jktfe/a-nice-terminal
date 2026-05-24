---
doc_id: dogfood-codex-yolo-2026-05-24
title: "Dogfood run — claudev4 spawns codex --yolo on manual-canvas slice 5"
status: in-progress
visibility: oss
observer: "@claudev4"
peer_reviewer: "@speedyclaude"
greenlit_by: "@you (msg_dnlrvie7y6 in orsz, relayed yz4clwzvbm msg_r8wufa5b5z)"
linked_rooms: ["yz4clwzvbm"]
started_at: 2026-05-24T20:30:00Z
---

# Dogfood: claudev4 spawns codex --yolo

JWPK proposal (yz4clwzvbm msg_tf7mo259qq): open a room → add a terminal → bring in a codex via the bring-in-LLM shortcut → instruct it to complete the manual canvas → capture spawn/onboarding friction from the OBSERVER side because the spawned agent will just struggle through silently.

## Locked plan (4 refinements via @speedyclaude)

1. **Task**: manual canvas slice 5 (Playwright auto-extract pipeline). Real ticket, not synthetic.
2. **Brief shape**: task + room URL only. No onboarding instructions, no memory pointers, no ledger-rule mention. Whether the codex discovers the onboarding banner / pulls memory / writes a ledger row IS the signal.
3. **Peer-ACK loop unchanged**: spawned codex finds its own reviewer (@speedyclaude or @speedycodex). I do NOT pair-review. If the codex forgets to ping a peer, THAT'S the highest-signal observation.
4. **30-min hard stop on no-progress** OR end of overnight window (~05:00 BST), whichever first.

Plus the JWPK + @speedyclaude reframe: **compact-as-deliberate-test, not emergency**. ANT's product thesis is "compact freely, room is your memory" (14-day-pumping-content proof point). I'll trigger at least one mid-observation compact and measure rehydration time.

## Observation channels

- Room transcript (the spawn room, created below)
- `ant view <terminal-id>` for raw CLI stream (catches verbose friction the codex summarises away)
- This doc, append-only

## Findings — append-only

Format: `[ISO timestamp] [SYMPTOM] symptom one-line. [ATTEMPT] what the agent did. [BUG?] inferred cause if clear. [SOURCE] room msg id or terminal output line.`

### Pre-spawn baseline observations

These are findings about the **bring-in-LLM workflow** before the codex is even spawned — my friction landing on the discovery side.

---

#### [2026-05-24T20:30Z] Finding #1: no CLI verb for "spawn a codex agent"

- **SYMPTOM** `ant --help` lists 35+ verbs (rooms, room, reaction, status, delivery, audit, docs, linkedchat, fingerprint, mcp, remote, router, remote-room, stage, agents…). None of them spawn a new agent process. Closest: `ant agents` — but its sub-verbs are `list | show | set | status`. `set` configures an EXISTING agent's display (colour/icon/bg-style). `status` filters by attributes. None create a new agent process.
- **ATTEMPT** Tried `ant agents --help`. Confirmed no spawn verb. JWPK's framing "shortcuts to take them to a-nice-terminal and launch a codex with --yolo" suggests the shortcut lives in the WEB UI (room page), not the CLI.
- **BUG?** Discovery gap: an operator who reads `ant --help` to find the spawn affordance won't. If the bring-in-LLM buttons are web-only, the CLI surface should at LEAST mention "see /rooms/[id] for agent spawn" or `ant rooms bring-in --help`.
- **SOURCE** Local CLI output, 2026-05-24T20:30Z.

#### [2026-05-24T20:31Z] Finding #2: `ant rooms create` flag-vs-positional UX inconsistency

- **SYMPTOM** Tried `ant rooms create --name "dogfood-codex-yolo-slice5"` (mirroring the `--flag` style every other verb uses, e.g. `ant router start --room ROOM --handle @h`). Output: full top-level help screen (no rooms-specific guidance), no error message about WHY.
- **ATTEMPT** Tried `ant rooms create --help`. Got `Error: rooms create needs a name` followed by the same top-level help dump. Reading the source (`scripts/ant-cli.mjs:195-207`) revealed `createRoom(name, runtime)` takes `name` as a POSITIONAL arg, not `--name`. So the actual working syntax is `ant rooms create "the name"` (no flag).
- **BUG?** Two-layer issue: (a) `rooms create` is one of the only verbs that uses positional args — inconsistent with `router start --room --handle`, `agents set --color --icon`, etc; (b) on failure, the error reverts to the TOP-LEVEL `ant --help` rather than `ant rooms --help` or `ant rooms create --help`. Operator can't even discover what flags `rooms create` accepts without grepping source.
- **SOURCE** Local CLI output + scripts/ant-cli.mjs:195-207, 2026-05-24T20:31Z.

#### [2026-05-24T20:35Z] Finding #4: bring-in-codex affordance lives at `/cli-agents`, NOT on the room page

- **SYMPTOM** JWPK's pitch was "open a room → add a terminal → bring in a codex via shortcut". After creating the room, I expected an in-room "Bring in" button. Grep across `src/routes/**` found the actual codex-spawn UI at `/cli-agents/+page.svelte` — a separate top-level dashboard page with `Start codex` / `Start pi` buttons. There's no in-room equivalent.
- **ATTEMPT** Looked for an Apple-Shortcuts integration too (JWPK said "using the shortcuts"). `ls ~/Library/Shortcuts` returned no codex-related entries. So "the shortcut" is most likely the `/cli-agents` page button, not an Apple-Shortcuts macro.
- **BUG?** Discoverability: the JWPK pitch implies a per-room affordance ("open a room → bring in a codex"). The actual affordance lives at a separate dashboard route with no obvious link from the room page. An operator following JWPK's mental model lands on `/rooms/[id]` and sees no spawn button.
- **SOURCE** Grep + filesystem inspection, 2026-05-24T20:35Z.

#### [2026-05-24T20:36Z] Finding #5: codex spawn endpoint has NO roomId — room linkage is a manual follow-up

- **SYMPTOM** `POST /api/cli-agents` body is documented as `{cli, cwd?, sessionDir?, binary?}` — no `roomId` parameter (`src/routes/api/cli-agents/+server.ts`). The spawned codex is room-DETACHED. To coordinate with the dogfood room, the codex would need to discover the room ID + run `ant register` + `ant invite redeem` (or equivalent) + start posting via `ant chat send` — at least 3-4 separate steps the codex has to discover.
- **BUG?** JWPK's pitch suggests an integrated flow ("open a room → bring in a codex"). The implementation splits the workflow into two unrelated surfaces (rooms vs cli-agents) with no automatic linkage between them. Steps 2-5 of "give the codex a way to talk to this room" are exactly the onboarding friction we're hunting — it's not a side effect; it IS the dogfood signal.
- **CLASS: DESIGN-VS-BUILT DRIFT** (per @speedyclaude yz4clwzvbm msg_j6d6w3jsaf). The contract spec for one-tap room-aware spawn lives in `project_bring_in_llm_buttons_2026_05_23` banked memory — design exists; wire doesn't. This is the exact pattern the bring-in-LLM-buttons banked design was meant to close. Worth surfacing every time this gap pattern shows up: spec banked but wire missing → either ship the wire or unbank the spec, but don't leave the operator's mental model split between them.
- **PROPOSED FIX** (for the post-overnight backlog slice): single `POST /api/rooms/:roomId/bring-in-cli-agent` body `{cli: 'codex'|'pi', cwd?, handle?, kind?}` that does mint-invite + create-handle + register-terminal + bind-to-room-membership in one round-trip. Room page gets the in-room button. Existing `/cli-agents` Start-codex remains as the room-detached escape hatch.
- **SOURCE** `/api/cli-agents/+server.ts:50-78` + `/cli-agents/+page.svelte:45-67`, 2026-05-24T20:36Z.

#### [2026-05-24T20:46Z] Finding #6: bring-in-LLM premise has no operator-facing prompt channel — the dogfood task itself isn't completable as proposed

- **SYMPTOM** After successfully spawning the codex via `POST /api/cli-agents` (handleId `agent_codex_6sbyk4ea_1779658005796`, sessionId `null`), I went to give it the slice-5 brief. There is no operator-facing way to send a text prompt to a running codex:
  - `/cli-agents` page exposes Start / Stop / `compact` / `abort` buttons. No text-input box. (`src/routes/cli-agents/+page.svelte:180-181`)
  - `POST /api/cli-agents/:handleId/command` requires a JSON-RPC `{method, params}` shape; the method names are undocumented externally — the operator has to grep `src/lib/server/codex/codexLifecycle.ts` to find them (`sendRequest('initialize', ...)` is the only one visible at the bridge layer). What method to call to deliver a user prompt is not explained anywhere.
  - The bridge has stdin to the codex process but no operator surface exposes it.
- **BUG?** **This is the load-bearing finding.** JWPK's pitch was "open a room → bring in a codex → instruct them to complete the manual". Steps 1 + 2 work (room create, codex spawn). Step 3 — instruct them — has NO IMPLEMENTATION. The dogfood task as proposed can't actually run because the operator can't deliver a brief to the spawned codex through any current surface.
- **CLASS: SPEC-VS-IMPL GAP** — the most acute instance of design-vs-built drift in the bring-in-LLM family. Banked spec exists ([[bring-in-llm-buttons-2026-05-23]]); the spawn endpoint ships; the input-channel ship doesn't.
- **PROPOSED FIX** (post-overnight backlog slice — possibly elevated to "next priority" given it blocks the dogfood premise itself):
  1. Add a `<textarea>` to `/cli-agents/+page.svelte` per running agent with a Send button.
  2. New `POST /api/cli-agents/:handleId/prompt` that wraps the codex JSON-RPC `sendUserInput` (or equivalent) so operators don't need to know the protocol method names.
  3. Optional: integrate with the room (per finding #5's proposed `POST /api/rooms/:roomId/bring-in-cli-agent`) so the brief auto-routes through chat rather than a separate textbox.
- **STATUS: SHIPPED 2026-05-24** — pivoted dogfood Option A (approved in yz4clwzvbm) and built sub-items 1 + 2 in worktree `claudev4/cli-agents-prompt-channel`. Authoritative method names verified via `codex app-server generate-json-schema`: lazy `thread/start` on first prompt, then `turn/start` with `input:[{type:'text',text}]` and `threadId` from the bridge state. Sub-item 3 (room-routed input) stays backlogged behind finding #5's room-aware spawn endpoint.
- **ACTION TAKEN** Stopped the spawned codex via `DELETE /api/cli-agents/<handleId>` to avoid leaving a runaway. `{"stopped":true}` returned cleanly.
- **SOURCE** `/cli-agents/+page.svelte:180-181` (Start/Stop/compact/abort, no prompt input) + `/api/cli-agents/[handleId]/command/+server.ts:14` ("protocol-specific" body, undocumented method names) + `src/lib/server/codex/codexLifecycle.ts:122-130` (only `initialize` visible at the bridge layer to a reader), 2026-05-24T20:46Z.

#### [2026-05-24T20:32Z] Finding #3: room creation worked but no acknowledgement of next steps

- **SYMPTOM** After `ant rooms create "dogfood-codex-yolo-slice5"` returned `Created uh1dj1c3o2 dogfood-codex-yolo-slice5`, the output is ONE LINE. No hint at the next-obvious-action ("add a terminal", "invite an agent", "open https://...").
- **BUG?** Discoverability gap: an operator coming from the JWPK pitch "open a room, add a terminal, bring in a codex" has just done step 1. Steps 2+3 have no CLI handle visible at this surface. The success-message could surface `ant agents bring-in --room uh1dj1c3o2 --kind codex --yolo` if that command existed, or at minimum a deep-link `https://localhost:6174/rooms/uh1dj1c3o2` so the operator can visually find the bring-in button.
- **SOURCE** Local CLI, 2026-05-24T20:32Z.


