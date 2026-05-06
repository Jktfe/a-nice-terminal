# Task #27 — Lazy-load Recent Messages: Acceptance Evidence (web half)

> **Acceptance test** — "Opening a chat does not download the entire room
> history; older messages stream in only when the reader scrolls toward the
> top, and the reader stays anchored to the message they were on."

Companions: `docs/m2-2-publish-summary-evidence.md` (the linked-chat side
panel that already shipped this exact pattern at
`src/routes/session/[id]/+page.svelte:476`).

The iOS half is parked — the repo does not currently contain a Swift app.
This document covers the web slice only and notes the iOS work as deferred
pending an iOS engineer or a re-scope of the task.

---

## What landed

Two bugs in one commit (`6429cca`).

- **Server — bounded latest-N path** (`src/routes/api/sessions/[id]/messages/+server.ts`).
  - `GET /api/sessions/:id/messages` previously parsed `?limit=` but only
    used it on the `since` and `before` cursor branches. The no-cursor path
    called the unbounded `listMessages()` and returned every message in
    the room on every page load.
  - New branch: `else if (limitParam)` calls
    `queries.getLatestMessages(sessionId, limit)` (DESC then reversed for
    ASC delivery), matching the established `before`-cursor pattern.
  - Backward compat preserved — when no `?limit=` is supplied the path
    still returns the full unbounded history. The single in-tree caller
    that does this is `src/lib/stores/messages.svelte.ts:21`.
- **Server — query** (`src/lib/server/db.ts:894`).
  - `getLatestMessages(sessionId, limit)` —
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`.
- **Client — scroll-up history** (`src/lib/components/ChatPane.svelte`).
  - New state: `hasMoreHistory`, `loadingHistory`, `PAGE_SIZE = 50`.
  - Initial load: `?limit=50` → if returned count equals page size,
    `hasMoreHistory = true`.
  - `onScroll` triggers `loadOlder()` when `scrollTop < 100` and
    `hasMoreHistory && !loadingHistory && messages.length > 0`.
  - `loadOlder()` fetches `?before=<oldest.created_at>&limit=50`, dedupes
    against existing message ids, prepends, and restores scroll position
    via `requestAnimationFrame` so the reader stays anchored.
  - "Loading earlier messages…" strip appears at the top of the feed
    while a fetch is in flight; "Start of conversation" terminator
    appears when `hasMoreHistory` flips false.

Pattern lifted directly from
`src/routes/session/[id]/+page.svelte:476-499` — the linked-chat side
panel implementation that has been in production since M2 #2.

---

## Tests

Four cases in `tests/messages-pagination.test.ts`:

1. **Bounded latest-N** — seeds 120 rows, requests `?limit=50`, expects
   exactly 50 messages back in ASC order matching the latest 50 ids
   (`msg-0070`..`msg-0119`).
2. **No-limit unbounded backward compat** — seeds 120 rows, requests with
   no query string, expects all 120 rows back. Protects the single
   in-tree caller in `messages.svelte.ts:21` from a behaviour change.
3. **Before-cursor** — seeds 120, fetches the latest 50, then pages back
   from the oldest of that page. Expects the next 50 (`msg-0020`..`msg-0069`).
4. **Exhaustion** — seeds 30, fetches `?limit=50` (returns 30), then
   pages back from the oldest. Expects 0 results — signals
   end-of-history to the client.

The seed helper inserts messages with explicit ms-resolution
`created_at` strings because Bun's `bun:sqlite` `DEFAULT CURRENT_TIMESTAMP`
is second-resolution and would collide on rapid consecutive inserts.

All four pass on `main` (438 total / 1 skip / 0 fail; svelte-check
809 / 0 / 0).

---

## Browser walkthrough

This is the manual test JWPK runs to validate the slice end-to-end.

1. Open `https://localhost:6458` and navigate to a busy room — ANTchat
   (`Z3pyk5CWNyGLzJIf_PQxp`) is the obvious candidate.
2. Confirm the latest 50 messages appear immediately. The list should
   render in ASC order with the most recent message at the bottom.
3. Scroll the message feed all the way up. Within ~100px of the top, a
   "Loading earlier messages…" strip should appear briefly and the next
   page of 50 older messages should be inserted at the top.
4. Confirm the message you were reading stays in view — the scroll
   anchor restoration via `requestAnimationFrame` should keep the
   viewport pinned to the message that was previously at the top.
5. Continue scrolling up. Each near-top trigger should fetch the next
   page until "Start of conversation" appears at the top of the feed,
   indicating the room's first message is now visible.
6. WebSocket realtime should keep working throughout — sending a new
   message from another client should append at the bottom regardless
   of where the reader is scrolled.

---

## What did not land (yet)

- **iOS half** — task #27 is titled "Lazy-load most-recent messages in
  web + iOS". The repo does not currently contain a Swift app or an
  Xcode project, so the iOS slice cannot ship from this lane. Either
  the task should be re-scoped to web-only or held open until an iOS
  engineer joins the project.
- **Plan event** — no `plan_test` flip was recorded; the M-track plan
  IDs cover M1–M6 and task #27 is a numbered queue task rather than
  an M-track milestone.

---

## Key code refs

- `src/lib/components/ChatPane.svelte:31-32` — new `hasMoreHistory` and
  `loadingHistory` state.
- `src/lib/components/ChatPane.svelte:46-83` — `onScroll` near-top
  trigger and `loadOlder()` implementation.
- `src/lib/components/ChatPane.svelte:170-180` — initial load with
  `hasMoreHistory` initialisation.
- `src/lib/server/db.ts:894-895` — `getLatestMessages` query.
- `src/routes/api/sessions/[id]/messages/+server.ts:86-108` — GET
  handler with the new `else if (limitParam)` branch.
- `tests/messages-pagination.test.ts` — four-case coverage.
