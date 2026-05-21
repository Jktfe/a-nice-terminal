# V3-RENDERERS-LIFT design — 2026-05-15

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Driver: JWPK pivot — "we have it working better in v3" — lift the v3
rich rendering components into fresh-ANT in place of regex-treadmill.

## v3 components to lift (inventory from a-nice-terminal/src/lib/components)

| Component | LOC | Purpose | Notes |
|---|---|---|---|
| `CommandBlock.svelte` | 590 | Rich blocks per run_event kind (command / agent_prompt / artifact / generic) with trust-tier styling, copy buttons, sticky head, status dot | + sibling module `CommandBlock/types.ts` — MUST copy together. NO marked/dompurify deps in this component. |
| `CommandBlock/types.ts` | small | RunEvent + payload type shapes (CommandBlockPayload / AgentPromptPayload / ArtifactPayload) | Lifted alongside `CommandBlock.svelte` per v3 module layout |
| `AgentEventCard.svelte` | 546 | Inline interactive prompt cards (7 EventClass kinds) | Needs AgentMenu type + agent-status types |
| `AgentMenuPrompt.svelte` | 384 | Slash-menu picker (`/handle`, `/agent`, etc) — uses marked + DOMPurify for high-trust markdown | DEFERRED to follow-up slice — needs composer trigger + the 2 npm deps |
| `AgentDot.svelte` | 44 | Coloured dot for agent state — uses Tailwind utility classes in v3 | REWRITE with scoped Svelte CSS — fresh-ANT has no Tailwind |

## v3 dependencies — porting strategy

Default: **adapt to existing fresh-ANT theme tokens** (`--accent` /
`--ink-strong` / `--surface-card` etc) rather than copy-port nocturne
wholesale. Map v3 `NOCTURNE.*` colour calls to fresh-ANT tokens during
copy. AGENTS roster moves to small new `$lib/shared/agentRoster.ts`.

Concrete file paths to copy:
- `src/lib/nocturne.ts` (v3) → `src/lib/nocturne.ts` (fresh-ANT)
  TRIMMED to just colour palette + AGENTS roster needed by lifted
  components. Skip surfaceTokens until needed by a later lift.
- `src/lib/components/CommandBlock.svelte` → same path.
- `src/lib/components/CommandBlock/types.ts` → same path
  (sibling module — copy with `CommandBlock.svelte`).
- `src/lib/shared/agent-status.ts` → type-only stub in fresh-ANT
  (AgentMenu, AgentDotState only — no runtime store).
- `src/lib/components/NocturneIcon.svelte` → same path.

**NO new npm deps** for V3-LIFT-1 or V3-LIFT-2. The `marked` +
`isomorphic-dompurify` pair is used by `AgentMenuPrompt.svelte` only —
add them only when AgentMenuPrompt is lifted in a future slice.

## Lift strategy (3 sub-slices)

### V3-LIFT-1: minimal-dependency components first (~30min)

1. Copy `src/lib/nocturne.ts` from v3 — trim to colour palette + AGENTS
   roster only (skip surfaceTokens).
2. Copy `NocturneIcon.svelte` verbatim.
3. **REWRITE** `AgentDot.svelte` (44L) — replace v3's Tailwind utility
   classes (`relative absolute rounded-full animate-breathe` etc) with
   scoped Svelte `<style>` blocks; preserve the same `AgentDotState`
   props contract.
4. Stub `$lib/shared/agent-status.ts` with `AgentDotState` type only.
5. Wire `AgentDot` into existing `TerminalHeader` status-dot slot.

### V3-LIFT-2: CommandBlock (~1-2h)

1. Copy `src/lib/components/CommandBlock.svelte` (590L) → same path in
   fresh-ANT.
2. Copy `src/lib/components/CommandBlock/types.ts` → same path
   (sibling module — required by CommandBlock import
   `./CommandBlock/types`).
3. Extend `$lib/shared/agent-status.ts` stub with the payload types
   used here: `CommandBlockPayload`, `AgentPromptPayload`,
   `ArtifactPayload` (types-only, no runtime).
4. **NO new npm deps** — CommandBlock does not use marked/dompurify.
5. Map fresh-ANT `terminal_run_events` shape → v3 `RunEvent` adapter
   helper (small fn in TerminalAntView).
6. Replace `TerminalAntView`'s `TerminalAntCommandBlock` rendering with
   `<CommandBlock event={mapToV3RunEvent(ev)} ... />`.
7. Browser-runtime verify: command/tool_call/agent_prompt kinds render
   with v3's richer affordances; trust-tier styling preserved.

### V3-LIFT-3: AgentEventCard (~1h, post researchant transcript-tail)

After researchant ships TRANSCRIPT-TAIL-CLAUDE so we have richer
kinds (`tool_use`, `tool_result`, etc) flowing:

1. Copy `AgentEventCard.svelte` (546L).
2. Wire as renderer for `agent_prompt` kind events (replacing current
   plain `prompt-body` block in `TerminalAntView`).
3. Approve/Deny callbacks wire to existing `/api/terminals/[id]/input`
   for keystroke injection (e.g. `y\n`).

## Trust + safety boundary

v3 components ALREADY enforce trust tiers (CommandBlock §3 in the
component: `richAllowed = trust==='high'` gates rich rendering branches).
Lifting preserves the model — fresh-ANT just needs to ensure event
shape carries `trust` field (already does via TerminalRunEvent type).

Markdown sanitisation (marked + DOMPurify) is OUT OF SCOPE for
V3-LIFT-1/-2/-3. Those deps + the markdown rendering branch are
exclusive to the deferred AgentMenuPrompt slice. The lifts in this
doc add no markdown surface and require no new npm deps.

## Out of scope (deferred)

- AgentMenuPrompt slash-menu — needs composer integration (Q for JWPK)
- TerminalLine.svelte / TerminalSummary.svelte / QuickLaunchBar.svelte —
  separate ANT-view slices; v1 keeps current TerminalAntView wrapper +
  swaps inner block renderer only
- ChatMessages.svelte — current TerminalChatView already serves; v3
  ChatMessages might polish bubble UX, defer
- `agent-status.svelte` reactive store — stub initially with empty
  `Map<sessionId, AgentDotState>`; backend wiring is a follow-up slice

## Acceptance

- Doc ≤180L
- V3-LIFT-1 unblocks AgentDot integration in TerminalHeader
- V3-LIFT-2 replaces TerminalAntCommandBlock with v3 CommandBlock
- V3-LIFT-3 swaps agent_prompt block for AgentEventCard
- Trust-tier guardrails preserved
- Browser-runtime verify: command/tool_call/agent_prompt kinds render
  with v3 rich affordances (copy buttons, sticky header, status dot,
  trust-tier styling). Markdown rendering is NOT in this slice's
  acceptance — that lives in AgentMenuPrompt's deferred slice.
- bun run check 0/0/0 + build PASS

## Ship order

1. V3-LIFT-1: AgentDot + nocturne minimal + NocturneIcon (~30min)
2. V3-LIFT-2: CommandBlock.svelte + CommandBlock/types.ts + agent-status stub types (NO npm deps) (~1.5h)
3. V3-LIFT-3: AgentEventCard wire-up (post researchant transcript-tail) (~1h)

Total ~3h frontend, parallelisable with researchant T2-ROUTING-ROLLBACK +
TRANSCRIPT-TAIL-CLAUDE.
