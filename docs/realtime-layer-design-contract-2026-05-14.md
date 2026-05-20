# Real-time layer (GAP-55) — design contract

Date: 2026-05-14
Author: @researchant
Status: DESIGN-FIRST. T1 polling stopgap impl follows immediately;
T2 proper WS port DEFERRED.
Cap: ≤120L. Addresses JWPK D2.x verbatim "I need to refresh for the
messages to show".

## TL;DR

Audit + disk verification: fresh-ANT has NO WebSocket infrastructure —
no server `ws-broadcast.ts`, no client `ws.svelte.ts`, no WS handler.
v3 has the full WS surface (~200L server + 82L client + ~15 broadcast
event types + globalThis singleton). A faithful port is 4-6hr including
server bootstrap (handler.js wiring), broadcast singleton, /ws endpoint,
client store, hookup in 5+ surfaces.

JWPK is dogfood-blocked NOW. Two-slice partial-framing:

- **T1 (THIS slice)**: client polling via `invalidateAll()` at 3s interval
  in the room view ONLY. Crude, works immediately, ~15L diff. Deletes
  when T2 lands.
- **T2 (DEFERRED)**: proper WS port. Server-side ws-broadcast singleton
  + /ws handler + client store + per-event-type wiring. Full audit-spec
  scope.

## Q1 — T1 mechanism

`onMount` in `/rooms/[roomId]/+page.svelte` → `setInterval(() => invalidateAll(), 3000)`
→ SvelteKit re-runs the `+page.ts` load → server returns fresh messages
→ `$derived(data.messages)` re-evaluates → MessageList re-renders.
`onDestroy` clears the interval.

## Q2 — T1 scope bound

Polling ONLY in the room view (where JWPK is blocked). NOT on Dashboard
(rooms list refreshes are less critical and shipped Dashboard is fresh).
NOT on /asks, /plan, /search (those are edit-rare surfaces).

## Q3 — T1 polling interval

3000ms. Trade-off: 1s = chat feel but 60 reqs/min/tab; 5s = noticeable
lag; 3s = chat OK + 20 reqs/min. JWPK can dogfood with 3s; T2 WS makes
this irrelevant.

## Q4 — T1 cleanup discipline

- Visible TODO comment pointing at THIS doc + T2 plan-event id.
- `setInterval` returns + onDestroy clears (no leak across nav).
- Tab-hidden detection NOT included v1 (nice-to-have for T2).

## Q5 — T2-A SSE shape (delta-2, replaces WS-first plan)

Disk-verify: fresh-ANT uses `@sveltejs/adapter-node` started via
`node build/index.js`. WS upgrade would need a custom server.js wrapper +
`ws` package dependency + launch-path modification — high risk during
JWPK live dogfood. **T2-A delta-2: ship Server-Sent Events (SSE)
instead.** SSE works in a standard SvelteKit `+server.ts` route via
`ReadableStream`, no adapter or launch changes. One-way (server→client)
covers the immediate JWPK pain (message broadcast); typing/chair stay
HTTP POST + reflected via SSE.

T2-A ships (this lane after T1 lands):
- NEW src/lib/server/eventBroadcast.ts (~80L) — globalThis singleton
  per banked feedback_globalthis_pattern. Methods: subscribe(roomId,
  controller) / unsubscribe / broadcast(roomId, event).
- NEW src/routes/api/realtime/[roomId]/events/+server.ts (~60L) — GET
  returns `text/event-stream` ReadableStream; controller registered with
  the singleton on start, removed on cancel.
- EDIT src/routes/api/chat-rooms/[roomId]/messages/+server.ts: call
  `broadcast(roomId, {type:'message_added', message})` after commit.
- NEW src/lib/stores/realtimeRoom.svelte.ts (~60L) — EventSource
  subscriber returning a $state-backed last-event ref the room view can
  $effect on to invalidate.
- EDIT src/routes/rooms/[roomId]/+page.svelte: replace polling with
  realtimeRoom subscription; invalidateAll() on each new event.
- T1 polling REMOVED in same slice.

**T2-B (DEFERRED — full WS later if SSE proves insufficient)**: WS
upgrade for bidirectional surfaces (typing indicators, presence). Most
events fit one-way SSE so T2-B may never be needed.

## Touch points (T1 only)

- EDIT src/routes/rooms/[roomId]/+page.svelte: add ~15L polling
  setInterval in onMount + cleanup in onDestroy. TODO comment.
- NO server-side changes.
- NO new components.

## Locked acceptance (T1)

- Open room view, post message via curl from another shell, message
  appears within 3s without manual refresh.
- onDestroy cleanup verified (navigate away → no leaked interval).
- TODO comment points to THIS doc + T2 plan id.
- svelte-check passes 0 errors 0 warnings.
- Plan event `realtime-t1-polling-stopgap` status=done after canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| Build full WS now under T1 label | 4-6hr work; JWPK blocked NOW. T1 ships in 30min. |
| Broader-surface polling (Dashboard / asks) | Scope creep; T1 = unblock-JWPK-room-chat. |
| Sub-second polling | 60+ reqs/min/tab; T2 WS is the right answer. |
| SSE instead of WS for T2 | WS supports bidirectional (typing); SSE is one-way. |
| Skip T2 contract preview | Future me + reviewer need to see the deferred shape. |

## Open questions for JWPK

1. T1 interval 3s acceptable as stopgap? Default: yes.
2. T2 priority after dogfood satisfaction? Default: high; one-of-next-3-slices.

## Next step

T1 implementation proceeds claim-first under THIS doc Locked Acceptance.
