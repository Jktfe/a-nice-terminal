# Terminal frontend research-eval — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Source: JWPK terminals-first pivot + researchant TERMINALS BACKEND design PASS

## Why

Coordinator allocated the terminal-pane FRONTEND lane. JWPK's verbatim
priority: "Web UI can create a terminal + attach a tmux session +
output visible live + linked into room/chat". Backend contract is now
locked (researchant's design PASSed 143L/180). Per banked
research-and-evaluate-before-v3-lift discipline, this doc scouts the
v3 Terminal.svelte source + locks a fresh-ANT impl plan against the
locked backend surface BEFORE any code lift.

## v3 Terminal.svelte audit

- 664 LOC at `/CascadeProjects/a-nice-terminal/src/lib/components/Terminal.svelte`.
- Deps: `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-serialize`
  (lazy-imported under `browser` guard).
- Transport: WebSocket. Sends `{ type: 'terminal_input', sessionId,
  data }` upstream; receives output messages from the same socket.
- Filters: regex blocks `xterm`-emitted CSI cursor-position responses
  (`^\x1b\[\??[>]?[\d;]*c$` etc) from looping back as input. Same for
  OSC 10/11 colour query responses.
- Write queue: ≥256B chunks coalesce 2ms to avoid xterm ANSI-state
  thrashing under bulk output.
- Mobile special-keys row (Ctrl, Esc, Tab, arrows etc) via
  `$lib/shared/special-keys`.
- Scroll-track drag handling (pointer events) for buffer navigation.
- Fit-on-resize via FitAddon + window resize listener.

## Backend contract (researchant TERMINALS BACKEND delta-1 PASS)

- `POST /api/terminals` body `{ sessionId?, cwd?, cols?, rows? }` →
  spawn / attach a tmux new-session -A via /.ant/pty.sock daemon.
- `GET /api/terminals` → list active sessions (server-side
  `type:list` IPC over daemon socket).
- `GET /api/terminals/:id/stream` → SSE per-terminal stdout/stderr.
- `POST /api/terminals/:id/input` body `{ data }` → write keystroke or
  paste payload to the PTY.
- Resize endpoint TBD with researchant; assumed `POST
  /api/terminals/:id/resize { cols, rows }`.
- No arbitrary cmd/args — default shell/tmux only.

## Frontend impl plan (T1 scope, partial-frame friendly)

**T1 deliverables (~400 LOC):**

1. Add `@xterm/xterm` + `@xterm/addon-fit` to `package.json` (defer
   serialize-addon — needed only for buffer-persistence, not v1).
2. NEW `src/lib/components/Terminal.svelte` — xterm + FitAddon lazy
   import under `browser` guard. Props: `terminalId`, `cols`, `rows`,
   `onInput?`. Subscribes to `EventSource('/api/terminals/<id>/stream')`
   and writes incoming data chunks via the same write-queue pattern as
   v3 (chunked + coalesce to keep xterm happy). Captures `term.onData`
   → POST `/input`. Resize → POST `/resize`.
3. NEW `src/lib/terminal/ansiResponseFilter.ts` — copy the v3
   CSI_RESPONSE_RE + DSR/colour-query block list. Pure function with
   bun-test coverage.
4. `src/routes/terminal/+page.svelte` — replace the 48L stub with a
   real route: create-form (cwd input) → POST `/api/terminals` →
   mount `<Terminal terminalId={...} />`. List of existing terminals
   above the create form (GET `/api/terminals`).

**T2 deliverables (deferred, separate slice):**

- Room-embedding: per-room `<TerminalPane>` slot inside
  `/rooms/[roomId]` so a terminal can be tied to a chat. Likely a
  `CollapsibleSection` in the existing Room Options dropdown.
- OSC 0/1/2 title parse + display in terminal header card.
- Agent-fingerprint badge driven by server-side OSC parse (researchant
  T3 lane).

**T3 deliverables (deferred):**

- Mobile special-keys row.
- Scroll-track drag.
- Serialize-addon buffer persistence across reconnects.
- Paste-buffer integration with the shared screenshot pool.

## Open Qs for researchant before T1 impl-claim

**Q1** — resize endpoint shape: confirm `POST
/api/terminals/:id/resize { cols, rows }` OR fold resize into the
input POST as a control-message variant? Recommend separate endpoint
for clarity.

**Q2** — SSE event types: confirm output frames are plain `data:
<bytes>` chunks OR JSON-wrapped `{ type: 'output', data }`. v3 used
JSON via WS; SSE could go either way. Recommend plain-bytes for
performance (no per-frame parse on the hot path) with a single
`event: error` channel for daemon-side failures.

**Q3** — initial cols/rows: SSR-time we don't know browser viewport.
Recommend defaulting backend spawn to 80×24, client immediately fires
a `/resize` after FitAddon measures actual cell grid.

## Acceptance for this research-eval slice

1. Doc under 180L, canonical RQO PASS.
2. Implementation plan + scope sizing + 3 open Qs surfaced.
3. researchant + RQO sign off Q1-Q3 → T1 impl-claim cleared.
4. No code shipped in this slice (scout-only).

## Out of scope

- Any code change this tick — scout-only.
- v3 lift of MentionAutocomplete / special-keys / scroll-track — T3.
- Browser-side OSC parse / agent-fingerprint UI — T2.
- Per-room embed contract negotiation with Room Options dropdown
  surface — T2.
