# Terminal kill/stop UX design — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Driver: JWPK EvoluteAnt kill/stop spec — destructive process-stop action
distinct from delete/archive

## JWPK verbatim spec (locked)

> Stop/Kill action in terminal card header or overflow menu, with
> confirmation if destructive. Raw tmux attach candidates should also
> expose a kill/close option (secondary/destructive). Participant/room
> controls should be able to stop a terminal/remote where permission
> allows. Killing should update the list immediately: alive=false or
> remove from live candidates, without refresh. Separate from delete/
> archive.

## Locked assumptions (no JWPK gate)

| # | Assumption | Why |
|---|---|---|
| A1 | Kill = tmux-kill-session; row stays; no alive column write — `alive` is DERIVED at GET from tmux liveness | Per S6 ship + JWPK audit-trail intent |
| A2 | Delete/archive = SEPARATE later slice | JWPK explicit |
| A3 | ANT-terminal kill button = small "X" in TerminalHeader right side | Discoverable next to view-switcher |
| A4 | Tmux-chip kill = small "×" on chip itself, opacity 0.4 → 1 on hover | Secondary action, doesn't dominate primary attach affordance |
| A5 | Confirmation modal: "Kill terminal `{name}`? This stops the tmux session." + [Cancel] [Kill] | Destructive — must require explicit click-through |
| A6 | After kill: optimistic UI (chip moves to dead-state styling immediately) + SSE refresh confirms | Snappy + correct |
| A7 | 403 from allowlist guard → toast/inline error "Not authorised to kill this terminal" | Polite degrade |

## Component deltas

### TerminalHeader.svelte (~+30L)
- Add right-side `kill` icon button (X) before view-switcher chips
- Optional: in compact width (<480px), tuck into an overflow `⋯` menu
- Props: `onKill?: () => void` callback
- Disabled when `status === 'killed'` (already dead)

### TerminalCard.svelte (~+40L)
- `async function killTerminal(): Promise<void>` — POSTs to
  `/api/terminals/[id]/kill`, handles 403 / 404 / 500
- `killModalOpen = $state(false)` + confirmation flow
- Pass `onKill={() => { killModalOpen = true; }}` to header
- On confirm → fire killTerminal → optimistic header status="killed"
- On 403 → surface as inline error pill on the card

### /terminal/+page.svelte (~+50L)
- Tmux-chip: add `×` secondary button (positioned absolute top-right
  of chip OR appears on chip hover)
- Click handler `killTmuxSession(pane: TmuxPane)` → confirmation modal
  → POST `/api/terminals/[sessionId]/kill` (same canonical endpoint)
- After successful kill: optimistic remove pane from tmuxSessions
  state; reconcile on next loadTerminals
- ANT-chip dead-state: existing `class:dead` already shows opacity
  0.55 — sufficient for v1

### Confirmation modal (shared, ~+50L NEW or reuse claim modal pattern)

```
<KillConfirmModal
  open={killModalOpen}
  targetKind="ant-terminal" | "tmux-pane"
  targetLabel="{name|sessionId}"
  onCancel={...}
  onConfirm={...}
/>
```

Standardised destructive-action modal — could be reused later for
delete/archive slice. Title is red-accent ink. Confirm button label
uses verb ("Kill") not generic "Confirm".

## Backend contract requested from researchant S6 (locked shape)

1. **`POST /api/terminals/[id]/kill`** — single canonical shape; same
   endpoint handles BOTH record-backed sessionIds AND bare tmux sessionIds.
   Caller passes sessionId; backend disambiguates.
   - Record-backed → auth via `canCallerActOnTerminal(callerHandle, record)`
     → 403 if denied
   - Bare tmux → auth caller==operator-handle
   - Effect: `tmux kill-session -t <sessionId>`. NOTE: `alive` is a
     DERIVED field at GET time from the live daemon `listTerminals()`
     output — there is no `alive` column on `terminal_records`. Kill
     does NOT write any column on the record; next GET omits the killed
     sessionId from `tmuxSessions` and the `alive` derived flag on the
     `terminals[]` entry computes as false.
   - Returns: `{ ok: true, sessionId, killed: true }`
2. **Live refresh shape (per S6 ship)**: kill broadcasts a `killed`
   event on the killed terminal's per-terminal SSE stream (the existing
   `/api/terminals/[id]/run-events/stream` channel). This means:
   - A user viewing the killed terminal's ANT/Raw view sees the event live
   - The /terminal LIST page does NOT auto-refresh (no list-level SSE);
     it relies on optimistic local state + reload reconciliation
   - List-level SSE could be a follow-up slice if dogfood needs it

## Trust + safety boundary

- Kill is **destructive but reversible** in the sense the tmux pane can be
  re-spawned with same name (creates new sessionId). Linked-chat-room
  persists separately so historical conversation is not lost.
- 403 from allowlist guard prevents non-creator + non-operator + non-
  allowlist from killing other people's terminals
- Confirmation modal IS the safety gate — no fly-by-click kills

## Out of scope (deferred)

- Delete/archive flow (JWPK explicit: "separate")
- Bulk-kill all-tmux-panes — niche
- Re-spawn from killed terminal_record row preserving handle — separate slice
- Room-side participant-kill action — JWPK mentions but defer until per-
  room ACL design lands

## Acceptance

- Doc ≤180L
- 3 components diffed + new KillConfirmModal
- Backend S6 contract documented for researchant pickup
- Browser-runtime verify with claude-code terminal:
  - Card header X click → confirmation modal → submit → tmux kills →
    header shows status="killed" + chip moves to dead-state
  - Tmux-chip × click → confirmation modal → submit → chip disappears
    from top tier
  - 403 case: kill another terminal as non-allowlist caller → error
    surface, no kill

## Ship order (post-backend)

1. **KILL-1**: KillConfirmModal component (~30min)
2. **KILL-2**: TerminalHeader X icon + onKill prop (~20min)
3. **KILL-3**: TerminalCard killTerminal + POST /kill + 403 handling (~45min)
4. **KILL-4**: /terminal page tmux-chip × secondary action → same POST /api/terminals/[id]/kill (~30min)
5. **KILL-5**: browser-runtime acceptance + JWPK retest iter (~30min)

Total ~2.5h post backend S6.
