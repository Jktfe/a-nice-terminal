# T2 FRONTEND design — TerminalCard + 3 view-renderers — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Anchor: /Users/jamesking/CascadeProjects/a-nice-terminal/docs/ANTstorm-terminal-research.md (1008L)
Companion: docs/terminal-v3-audit-2026-05-14.md (this repo, 174L)
Backend partner: researchant T2a PASS (terminal_run_events + raw-scrollback store)

## JWPK locked from session

- Q1 — ONE terminal entity, sessionId hidden, userName user-visible + editable
- Q2 — header chips switch view-mode (Chat / ANT / Raw), inside TerminalCard
- Q3 — input from any view-mode goes through the SAME pty.write path (chat-view input is keystrokes, not client-side filter)
- Filtering: ALL output flows to ALL 3 views; views are different RENDERERS over the same event stream

## ANTstorm anchor mapping (Track 1 + Track 2)

| ANTstorm concept | T2 frontend mapping |
|---|---|
| run_events append-only event log (Track 1) | researchant's `terminal_run_events` table, GET /api/terminals/[id]/run-events |
| trust tiers (high/medium/raw) | ANT view renders per-tier styling; Raw view renders any kind verbatim |
| CommandBlock.svelte rich block | New `AntEventBlock.svelte` — kind-switched render in AntView |
| Track 2 "xterm = live tail, SQLite = deep history" | Raw view = current Terminal.svelte (bounded scrollback) |
| Interpreted view ↔ raw bytes toggle | View-switcher chips on TerminalCard |
| Per-block toolbar (copy / re-run / bookmark) | AntEventBlock toolbar (T2-followup, not v1) |
| Inline prompt overlays (Track 1 §7) | DEFERRED to T3 — v1 renders agent_prompt as styled card, no overlay positioning |

## Component shape

```
<TerminalCard
  terminalId={...}      // hidden from user
  userName={...}        // editable inline, persists via PATCH /api/terminals/[id]
  routingRoomId={...}   // researchant T2e — display only in v1
  defaultView={'chat'|'ant'|'raw'}
/>
  ├── TerminalHeader.svelte       // name input + view-switcher chips + status dot
  ├── TerminalChatView.svelte     // run-events filter kind='message' → MessageRow
  ├── TerminalAntView.svelte      // run-events all kinds → AntEventBlock kind-switched
  └── Terminal.svelte (existing)  // raw view, current T1 xterm pane (max-height fix)
```

## Data flow

**TWO SSE streams** (researchant Q4 answered TWO in v3 audit):
1. `/api/terminals/[id]/stream` — raw bytes for xterm (existing)
2. `/api/terminals/[id]/run-events/stream` — parsed events for Chat + ANT views (researchant T2d)

v1 fallback while researchant lands T2d streaming: Chat + ANT views poll `GET /run-events?since=...` every 2s and fan-out via `EventSource` once it lands. Same component contract either way — only the subscription primitive changes.

**Input handling** (Q3 lock): every view calls `postInput(data)` → POST /api/terminals/[id]/input. Chat-view composer sends the line + `\r`; Raw-view sends keystrokes via xterm.onData. ANT-view input may be deferred (read-only by default, or share Chat composer at bottom).

## Renderer contracts

### TerminalChatView.svelte (~120L)
- Subscribes run-events; filters `kind === 'message'`
- Reuses fresh-ANT MessageRow component (already lifted in /rooms/[roomId])
- Composer at bottom: textarea + send button → POST /input (line + `\r`)
- Empty state: "No chat-formatted output yet — switch to ANT or Raw view"

### TerminalAntView.svelte (~150L)
- Subscribes run-events; renders ALL kinds via per-kind block component
- v1 kinds (researchant T2b parser scope): `raw` / `message` / `command` / `tool_call` / `thinking` / `agent_prompt`
- Each block: timestamp + kind badge + body, click-to-expand for `raw_ref` byte range
- Scroll: virtual list bounded ≤2000 rows on screen, "Load older" button
- Trust-tier styling: `trust='high'` ink-strong + accent border, `trust='medium'` ink-soft + dotted, `trust='raw'` mono escaped text

### Terminal.svelte (existing 154L, ONE delta)
- Add `max-height: 32rem` + `overflow: hidden` on `.ant-terminal-host` per JWPK pane-grows-indefinitely feedback
- xterm internal scrollback already 5000 → bounded tail per ANTstorm Track 2 §3

### TerminalHeader.svelte (~80L NEW)
- Inline-editable name input → PATCH /api/terminals/[id] { userName }
- View-switcher chips: [💬 Chat] [🐜 ANT] [⌨ Raw] — active chip border-accent
- Status dot: green=active / amber=idle / red=killed (derived from last run_event ts)
- Optional "linked to #room" pill when routingRoomId set

## Out of scope (T3 follow-ups)

- Per-block toolbar (copy / re-run / bookmark) — ANTstorm §2
- Inline prompt overlay positioning — ANTstorm §7
- Cross-terminal allow-list UI — researchant T2f backend lane
- Artifact rendering (images / markdown / screenshots) — needs /api/artifacts/ first
- Custom scrollbar / scroll-anchor states — ANTstorm Track 2 §6
- WebGL renderer flag — Track 2 §5
- Mobile special-keys row — v3 lift T3

## Acceptance

- Doc ≤180L
- All 4 components stub-rendered + wired to terminal_run_events
- View-switcher persists last-mode per terminalId in localStorage
- Name edit round-trips through PATCH + re-renders
- Raw-view max-height fix verified in browser at :6461
- No regression on existing /terminal route — TerminalCard becomes the new mount
- Browser-runtime verified end-to-end before claim-PASS (banked verify-runtime-via-lsof discipline)

## Ship order (claim-first slices)

1. **T2-FRONT-1**: TerminalHeader + view-mode state machine + max-height fix (~1.5h)
2. **T2-FRONT-2**: TerminalChatView reading run-events kind=message (~1.5h)
3. **T2-FRONT-3**: TerminalAntView with kind-switched AntEventBlock (~2h)
4. **T2-FRONT-4**: PATCH /api/terminals/[id] for name + /terminal route swap to TerminalCard (~1h)

Each slice ships claim-first under canonical RQO + browser-runtime verified before next claim.
