# v3 Terminal audit — fresh-ANT unified-terminal redesign — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Source: JWPK terminals-first pivot + JWPK architectural correction
(linkedchat ⊆ terminal as a view mode, not a separate concept)

## Why

JWPK's antv4 vision: ONE terminal entity, THREE view modes (Chat /
ANT / Raw) over the SAME pty stream. v3 mistakenly split linkedchat
into a sibling concept with its own session + table + adapter; v4
collapses that split. This doc audits v3 surfaces, identifies what's
liftable as a render-pipeline, and maps it to the unified architecture.

## v3 surface inventory

### Terminal.svelte (664L) — the RAW view (already in fresh-ANT)
- Lazy-loads `@xterm/xterm` + `addon-fit` + `addon-serialize`.
- WS transport for I/O; chunked write-queue (≥256B→2ms coalesce).
- Mobile special-keys row, scroll-track drag, tab-restore history fetch.
- CSI/OSC response filter (already lifted as
  `src/lib/terminal/ansiResponseFilter.ts`).
- Lift status: my fresh-ANT `Terminal.svelte` (154L, T1) is the
  raw-view core — REUSABLE under raw mode. Add max-height + parent
  overflow constraint per JWPK pane-grows-indefinitely feedback.

### ChatMessages.svelte (1271L) — basis for the CHAT view
- Renders an array of `messages` as chat bubbles with author / time /
  body / reactions. Same shape as fresh-ANT MessageRow already lifted.
- v3 linkedchat populates this from server-side pty parsing via
  `linked-chat-adapter` (server/adapters/linked-chat-adapter.ts:165L).
- Lift strategy for v4: do NOT lift the 1271L wholesale. Reuse the
  fresh-ANT MessageRow already in `/rooms/[roomId]`. NEW thin
  component `TerminalChatView.svelte` (~120L): subscribes to terminal
  SSE, runs a pty→message parser, feeds MessageRow.

### TerminalSummary.svelte (27L) — basis for the ANT view
- Hand-rolled 6-line summary: first 3 lines + `...` + last 3 lines,
  line count badge, "Terminal Output (N lines)" header.
- This IS the v3 "ANT view" JWPK referenced ("like we have already
  but improved"). Minimal but live.
- Lift strategy for v4: lift as `TerminalAntView.svelte` (~80L,
  improved): condensed line summary + agent-fingerprint badge +
  needs-input banner + last-activity timestamp + click-to-expand to
  full raw stream. SSE-driven, recomputes derived stats on each frame.

### TerminalContextStrip.svelte (389L) — telemetry strip, not a view
- Sibling component; renders agent-dot + telemetry above the terminal.
- v4 equivalent: header chips on the unified TerminalCard.

### linked-chat-adapter.ts (165L) — output routing logic
- v3 server-side fan-out: chat→terminal as raw keystrokes OR ANSI
  notification block based on `auto_forward_chat` + `role==='user'`.
- v4 lift mapping for researchant: this routing logic moves onto the
  terminal entity itself (room_routing field, allowed_terminal_ids).

## v3→v4 architecture mapping

| v3 concept | v4 unified-terminal mapping |
|---|---|
| Terminal session + linkedchat session (two rows in `sessions`) | ONE row in `terminals` table |
| linked-chat-adapter fan-out | Per-terminal `routing_room_id?` + view-mode-aware render |
| Terminal.svelte (raw only) | TerminalCard view-mode = `raw` |
| ChatMessages.svelte (for linkedchat) | TerminalCard view-mode = `chat` (via TerminalChatView) |
| TerminalSummary.svelte (ANT-style) | TerminalCard view-mode = `ant` (via TerminalAntView) |
| Separate /sessions/[id] route per type | ONE TerminalCard component, 3 view-mode chips |
| sessionId exposed in UI | sessionId hidden; user sees `userName` only |

## Proposed fresh-ANT component shape

```
<TerminalCard
  terminalId={...}
  userName={...}    // editable, persisted, the only user-visible identifier
  viewMode={'chat'|'ant'|'raw'}
/>
  ├── TerminalHeader.svelte     // name + edit + view-switcher chips
  ├── TerminalChatView.svelte   // SSE → pty parser → MessageRow list
  ├── TerminalAntView.svelte    // SSE → derived summary + agent badge
  └── Terminal.svelte           // SSE → xterm (current T1 raw view)
```

All three views consume the same `/api/terminals/:id/stream` SSE — view
switching is a render-pipeline swap, NOT a re-subscription.

## Deltas over v3 (v4 improvements)

1. **Unify**: drop the linkedchat-as-separate-session model; one
   `terminals` row, optional `routing_room_id` + `allowed_terminal_ids`
   on it.
2. **Hide sessionId**: user only sees `userName`. Backend `sessionId`
   stays internal (already the case in fresh-ANT — JWPK confirmed
   sessionId is "implementation detail").
3. **Pane sizing**: max-height + xterm-internal scrollback. v3's
   Terminal.svelte didn't constrain (same bug JWPK hit).
4. **View persistence**: remember last view-mode per terminal in
   client state OR per-terminal `default_view_mode` field.
5. **Naming**: `userName` editable from the card header (v3 had
   `display_name` on session but no inline-edit UX).

## Open Qs for JWPK (deferred, not blocking audit)

**Q1** — output routing field shape on terminal entity: single
`routing_room_id?` OR list (`routing_room_ids[]`) for multi-room
broadcast? (researchant lane will address.)

**Q2** — view-switcher placement: header chips inside card OR
sidebar (sticky)? v3 doesn't have a switcher today.

**Q3** — Chat-view input semantics: a user-typed line in chat-view —
does it go through the linkedchat raw-keystroke path (so it shows in
the terminal session) OR strictly client-side filter?

## Out of scope (T2/T3)

ANT-view live impl + cross-terminal allowed-list + mobile special-
keys row + scroll-track drag — all deferred to follow-up slices.

## Acceptance

Doc ≤180L, RQO PASS. 5-surface v3 inventory + 7-row v3→v4 mapping +
component shape + 3 open JWPK Qs + scout-only.

## Addendum: TWO classification layers needed (JWPK 3-view refinement)

JWPK lock: ALL output → all 3 views; each FILTERS the same stream.
Chat = messages-to-rooms/linkedchat. ANT = full fidelity (message +
thinking + tool-call) formatted + retained forever (server-side
persistence). Raw = tmux passthrough, ephemeral.

**Critical distinction surfaced by canonical RQO HOLD:** v3 has ONE
detector today, v4 needs TWO classifiers.

### Layer A — v3 interactive-event detector (already exists)

`agent-event-bus.ts` 1022L pipes pty.onData through
`driver.detect(raw): NormalisedEvent | null` (at most one event per
chunk). `EventClass` = 7 INTERACTIVE-PROMPT kinds (permission /
multi_choice / confirmation / free_text / tool_auth / progress /
error_retry). Surfaces AgentEventCards for user Approve/Deny/Choose.
NOT a general output classifier — fires only when an agent is
ASKING for input. LIFT-AS-IS into fresh-ANT — drivers' detect()
methods reusable verbatim.

### Layer B — v4 NEW output-content classifier (does NOT exist in v3)

For Chat + ANT filters. Classifies EVERY chunk into 0-N content
events: `message` (chat-bound) / `thinking` (reasoning block) /
`tool_call` (tool invocation) / `command` (shell + exit) / `output`
(plain stdout/stderr). Each `drivers/<cli>/driver.ts` (10+ CLIs)
gets a NEW `classify(raw): ContentEvent[]` method — designed +
built fresh, not lifted. Honest scope adjustment: this is BIGGER
than a pure v3 lift.

### v4 lift plan

- KEEP Layer A interactive detection as-is.
- NEW Layer B per-driver classifier — researchant lane.
- NEW `terminal_events` table (researchant): `id, terminal_id,
  ts_ms, kind, source, body, dest_room_id?`. Powers ANT
  retained-forever scrollback.
- NEW emit-time destination tagging on terminal `routing_room_id`.
- Chat filter: kind='message' AND room-scoped or terminal-local.
- ANT filter: ALL rows, per-kind formatter.
- Raw: unchanged.

### Backend boundary

researchant SLICE-2 owns: terminal_events schema + Layer B per-driver
+ emit-time tagging + per-event SSE. claude2 owns 3 view-renderers.

**Open Q4 for researchant:** TWO SSE streams (raw + parsed) OR ONE
multiplexed? Recommend TWO — separation of concerns.
