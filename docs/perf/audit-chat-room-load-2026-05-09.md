# Audit — chat-room load perf + memory

Lane M1 of `chat-room-load-perf-2026-05-09`. Observation-only; no
code edits. Cross-reference for codex's `chat-markdown-tables-2026-05-09`
which covers per-message render cost + markdown parse caching.

## Server endpoints (warm — measured 2026-05-09)

| Endpoint | Latency | Used in chat-room load? |
|---|---|---|
| GET /api/sessions/<id> | 8ms | yes (P1) |
| GET /api/sessions | 16ms | yes (P1) — for sidebar dropdown only |
| GET /api/sessions/<id>/messages?limit=50 | 14ms | yes (P2) |
| GET /api/sessions/<id>/tasks | 9ms | yes (P3) |
| GET /api/sessions/<id>/file-refs | 6ms | yes (P3) |
| GET /api/sessions/<id>/attachments | 6ms | yes (P3) |
| GET /api/workspaces | 7ms | yes (P3) — only used by switch-workspace UI |
| GET /api/sessions/<id>/participants | 8ms | yes — loadMentionHandles after P3 |
| GET /api/sessions/<id>/run-events?since=6h&limit=500 | 8ms | deferred (only on demand) |
| GET /api/sessions/<id>/links | 6ms | only for discussion rooms |

**Server is not the bottleneck.** Sum of all blocking server work
is ~80ms. The "couple of seconds" perceived load time is client-side
waterfall + connection setup + render.

## Current waterfall (loadSessionPage, +page.svelte:1352)

```
load
 │
 ├── Phase 1 (parallel)
 │   ├── GET /api/sessions/<id>
 │   └── GET /api/sessions
 │  (await both)
 │
 ├── Phase 2 (sequential after P1)
 │   └── msgStore.load(<id>)  →  GET /api/sessions/<id>/messages?limit=50
 │  (await)
 │
 ├── Phase 3 (parallel after P2)
 │   ├── GET /api/sessions/<id>/tasks
 │   ├── GET /api/sessions/<id>/file-refs
 │   ├── GET /api/sessions/<id>/attachments
 │   └── GET /api/workspaces
 │  (await all)
 │
 └── loadMentionHandles  →  GET /api/sessions/<id>/participants
    (sequential after P3)
```

Real wall-clock breakdown (estimated, cold load):

- Phase 1: ~200ms (TLS setup + max(8ms, 16ms))
- Phase 2: ~50ms (connection reused, 14ms)
- Phase 3: ~50ms (parallel)
- loadMentionHandles: ~50ms
- + Svelte hydration + first paint + WS connect: ~200-500ms

Total perceived latency: ~500ms-1s on warm, ~1-2s on cold.

## Critical observation: nothing in Phase 2 / 3 actually depends on Phase 1

- `msgStore.load(targetSessionId)` only needs the session ID (already
  in URL — no need to wait for getSession/listAllSessions).
- `tasks` / `file-refs` / `attachments` / `workspaces` only need the
  session ID.
- `loadMentionHandles` only needs the session ID (and an optional
  linked-chat ID, which only matters for terminal sessions).

**The 3-phase chain is artificial.** All 8 fetches could be in one
Promise.all. The chain exists because the code reads
`session.linked_chat_id` between P1 and P2 to decide whether to
load the linked chat — but that decision can be deferred until after
all data lands; the messages we'd be discarding are 50 rows × ~14ms
= a worthwhile loss for 200-500ms saved on the common path (chat
sessions, which don't have linked-chat data to discard).

## Top quick-wins (ranked by est. saved-ms)

### Q1 — Fold all 8 fetches into one Promise.all (est. saves 250-500ms)

Replace the 3-phase await chain with a single parallel batch. The
session details and the messages can both be in flight while tasks
/ refs / uploads / workspaces load. The loadSeq guard already
handles the case where a faster session-switch lands before the
slower fetches — same pattern works here.

Risk: low. The discriminator logic that picks chat vs terminal load
path runs on Phase 1 result; preserve that as a post-await branch
that decides what to render, not what to fetch.

### Q2 — Defer or skip listAllSessions on chat-room load (est. saves 150-300ms)

The full session list is only needed for the sidebar dropdown
("switch session"). On chat-room load it's always blocking the
critical path. Move it to a `setTimeout(0)` background fetch, or
fetch only when the user opens the sidebar.

Risk: low. The dropdown population can render after first paint
without harming the chat experience.

### Q3 — Defer workspaces fetch (est. saves 50-100ms)

`/api/workspaces` is only read to populate the workspace-switch
affordance in the right panel. On chat-room load, the user is not
switching workspaces. Defer to side-panel-open or to idle.

Risk: low. Same logic as Q2.

### Q4 — Eliminate sequential loadMentionHandles (est. saves 50-150ms)

Currently fires after Phase 3 awaits. Move into the same Promise.all
as Q1. The autocomplete dropdown isn't visible during load anyway;
the data just needs to be there by the time the user types `@`.

Risk: low.

### Q5 — Stream the first N messages as soon as they arrive (perceived only)

Instead of holding render until the messages array is fully
populated, render-as-arrive: pipe rows into the messages reactive
state as they decode. Saves perceived latency, not wall-clock.

Risk: medium — needs careful scroll-to-bottom anchoring.

## Memory observations

### M1 — `messages` array unbounded after `loadOlder`

`src/lib/stores/messages.svelte.ts:62` does
`messages = [...fresh, ...messages]` with no cap. If a user scrolls
back through a long-running room, the array can grow indefinitely
(weeks of history → many MB of message rows + reactive overhead).

Suggested fix: cap at 500-1000 rows; when `loadOlder` would push
over the cap, drop the newest tail (since we're scrolling up, we
care about the older end). Re-add with `loadOlder` if the user
scrolls back down.

Severity: low for typical use, real for power users on long rooms.

### M2 — `linkedChatMessages` likely unbounded similarly

Line 62 of messages store handles only the messages array; the
linkedChatMessages array in `+page.svelte:120` is updated separately
without inspection. Worth verifying it has the same bounding (if
not, same fix).

### M3 — Multiple loadMentionHandles call sites (4 in +page.svelte)

Lines 1214, 1236, 1392, 1613. Each refetches the participants
endpoint. Two are post-WS-event refreshes (reasonable), two are
duplicate "after Phase 3" + "after composing reply" calls. The
post-reply refetch is probably unnecessary if the WS event already
delivers the participant change.

Suggested fix: cache the last fetch result with a 1-2s TTL; subsequent
calls within the window return cached. Avoids redundant fetches in
fast-typing flows.

Severity: low (8ms server cost) but eliminates 3+ redundant fetches
per session interaction.

### M4 — Terminal `xterm` buffer disposal

`src/lib/components/Terminal.svelte` instantiates xterm.js per
session. Worth verifying that when the user navigates away, the
xterm buffer + any associated `IDisposable`s are properly disposed
(not just hidden). xterm.js buffers can be 1-5MB per active terminal.

Investigation note: codex's chat-markdown-tables lane is touching
MessageBubble; this Terminal.svelte concern is mine and lives in
M2 of this plan if confirmed as a leak.

### M5 — `runEvents` already bounded — keep it

`+page.svelte:650` already does `.slice(-1000)`. Good. Mention here
just so future audits don't redundantly flag it.

## Cleanup discipline

`onDestroy` blocks at lines 1452 and 1508 cover:

- `window.removeEventListener('keydown', onGlobalKeydown)` — good
- `window.removeEventListener('focus', handleLiveRefreshWake)` — good
- `document.removeEventListener('visibilitychange', ...)` — good
- `clearInterval(liveRefreshTimer)` — good
- `clearInterval(cmdPoll)` — good

Not seen but worth confirming exists somewhere:

- WebSocket listener removal on session change (subscriber pattern)
- `xterm` instance `.dispose()` per terminal
- Any in-flight `AbortController` for fetches superseded by faster
  session-switches (`loadSeq` guards prevent state pollution but
  don't cancel the network request)

## Recommended M2 implementation order

1. Q1 (single Promise.all) — 1 file, ~20 lines, biggest win
2. Q2 (defer listAllSessions) — 1 file, ~5 lines
3. Q4 (parallelise loadMentionHandles) — 1 file, ~3 lines
4. Q3 (defer workspaces) — 1 file, ~5 lines
5. M1 (cap messages array) — 1 file, ~10 lines
6. M3 (cache loadMentionHandles within 1-2s) — 1 file, ~15 lines
7. M4 (verify xterm disposal — investigation first, then fix if confirmed)

Q5 (streaming render) is more invasive and worth a separate lane.

## Out of scope (for codex's chat-markdown-tables lane)

- Per-message MessageBubble render cost
- Markdown parse memoization
- Table rendering pipeline

## Closing note

The "couple of seconds" pain is overwhelmingly client-side waterfall
collapse, not server slowness. With Q1+Q2+Q4 alone the cold-load
target of <500ms first-interaction looks achievable. Memory items
are real but second-tier — close them after the latency wins to
get the headline first.
