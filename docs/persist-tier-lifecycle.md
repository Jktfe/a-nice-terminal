# Persist tier — `broadcast_state` lifecycle

Phase E reference doc for `server-split-2026-05-11`. Captures the
contracts the three tiers rely on so a future contributor doesn't
have to re-derive them from grep + git blame.

If you're here because you're about to:
- write a chat message from anywhere except the SvelteKit POST handler
  → read [Writing a chat message](#writing-a-chat-message)
- add a new side effect to message-post → read [Tier 2 side
  effects](#tier-2-side-effects)
- touch the catch-up loop → read [Phase C catch-up loop](#phase-c-catch-up-loop)
- add a new direct `queries.createMessage` call site → read
  [When direct createMessage is OK](#when-direct-createmessage-is-ok)

## Three tiers

```
┌──────────────┐    ┌──────────────────────┐     ┌────────────────┐
│  CLI / MCP   │───▶│  Tier 1: persist lib │────▶│  SQLite (WAL)  │
│  (or HTTP)   │    │  writeMessage()      │     │  broadcast_    │
└──────────────┘    └──────────────────────┘     │  state column  │
                                ▲                 └────────┬───────┘
                                │                          │
                                │ best-effort notify       │ poll/replay (5s)
                                ▼                          ▼
                       ┌──────────────────────────────────────────┐
                       │  Tier 2: processor                       │
                       │  runSideEffects() + replayPending()      │
                       │   • channel HTTP fanout (idempotent)     │
                       │   • MessageRouter.route                  │
                       │   • asks WS broadcast                    │
                       │   • markBroadcastDone on success         │
                       └──────────────────────┬───────────────────┘
                                              │  WS events
                                              ▼
                                  ┌────────────────────────┐
                                  │  Tier 3: SvelteKit UI  │
                                  └────────────────────────┘
```

- **Tier 1** (`src/lib/persist/`) is the only place that writes chat
  rows. Synchronous. Wrapped in `db.transaction()`.
- **Tier 2** (`src/lib/server/processor/`) is the only place that fans
  the row out to the live system. Stays inside the SvelteKit process
  for now; a future phase can lift it into its own daemon without
  changing Tier 1's API.
- **Tier 3** is the SvelteKit UI. Killable. Restartable. Doesn't talk
  to the DB directly for writes.

## `broadcast_state` column

Added to `messages` in Phase A. Lives at
`src/lib/server/db.ts:240-244`.

| State | Meaning | Set by | Read by |
|---|---|---|---|
| `pending` | Tier 1 wrote the row; Tier 2 has NOT run side effects yet. | `writeMessage` (always inserts `'pending'`) | `replayPendingBroadcasts` |
| `done` | Tier 2 ran every side effect successfully. The row will NOT be replayed. | `runSideEffects` on success | (nothing; terminal state) |
| `failed` | Tier 2 ran 5 times and threw every time. The row will NOT be replayed further. | `runSideEffects` after `MAX_BROADCAST_ATTEMPTS` | operator (manual recovery) |
| `expired` | Pending row exceeded `maxAgeMs` (default 24h). Marked rather than skipped so the partial index stays small. | `replayPendingBroadcasts` | operator (audit) |

**Default for new rows inserted via `queries.createMessage` directly
is `'done'`.** Only `writeMessage` explicitly inserts `'pending'`.
Direct callers (focus digests, hooks, interview summaries) deliberately
skip the broadcast queue.

Partial index for the catch-up loop:
```sql
CREATE INDEX idx_messages_broadcast_pending
  ON messages(broadcast_state) WHERE broadcast_state='pending';
```

## Writing a chat message

**One entry point: `writeMessage(input)` from `$lib/persist`.**

```ts
import { writeMessage, WriteMessageError } from '$lib/persist';

const result = writeMessage({
  sessionId,
  role: 'user',
  content,
  senderId,
  source: 'http',         // or 'cli'
  // actorSessionId: 'session-id-from-~/.ant/config.json',  // required when source='cli'
});
```

What it does in one transaction:
1. Normalises input (`ensureTrailingMentionBoundary`, urgent-reason
   validation, ask-extraction setup).
2. Validates `reply_to` is in the same session.
3. Inserts the message row with `broadcast_state='pending'`.
4. Writes ask rows (`writeAsksForMessage`) and rewrites meta with
   `ask_ids`.
5. Auto-upserts `chat_room_members` for the sender.
6. Returns a `WriteMessageResult` with `message`, `asks`, `firstPost`,
   `isLinkedChat`, `senderResolved`, `routingHints`.

If anything throws inside the transaction, the message and ask rows
roll back together — verified by `tests/persist-write-message.test.ts`
"rolls back the message insert when a mid-transaction step throws".

### Auth gate for `source: 'cli'`

Three checks, in order:
1. **Source-validity.** `'http'` and `'cli'` accepted; `'mcp'` rejected
   with `WriteMessageError(400)` until that lane lands.
2. **Caller identity.** `actorSessionId` (from `~/.ant/config.json`)
   required; missing/empty → `WriteMessageError(403)`.
3. **Room membership.** Actor must be in `chat_room_members` for the
   target room.
   **Greenfield exception:** rooms with zero membership rows accept
   the first write so `ensureRoomMembershipForSender` (still inside
   the transaction) can seed the table — mirrors HTTP semantics where
   the first POST auto-creates membership. After the first write, the
   actor is in the table and subsequent CLI writes pass the strict
   check.

The persist library reads no filesystem and no environment. The
CLI passes `actorSessionId` through `MessageInput`. Without that
field, `source: 'cli'` is always rejected — there is no anonymous
fallback. Filesystem permission on `~/.ant-v3/ant.db` is the
boundary that gates *who* can call `writeMessage` at all.

## Tier 2 side effects

**One entry point: `runSideEffects(result, opts)`** in
`src/lib/server/processor/run-side-effects.ts`.

Order of operations (each step's success is required before the next):
1. **Channel HTTP fanout** — `fireChannelFanout` awaits every adapter.
   Per-adapter idempotency via `delivery_log`: each fetch is preceded
   by a `hasDelivered(messageId, adapter)` check; on `response.ok`,
   `delivered=1` is inserted before the function returns. `Promise
   .allSettled` preserves best-effort semantics (one channel down
   doesn't abort the others).
2. **MessageRouter.route** — WS broadcast + PTY injection + linked-
   chat fan-out. The router consults `RouteMessage.allowPtyInject`:
   on live posts it defaults true; on replays older than 30s
   `runSideEffects` passes `false`, which nulls both the `pty-injection`
   adapter AND the `linked-chat` adapter so stale typed input cannot
   reach a running agent's stdin.
3. **Asks WS broadcast** — `emitAskRunEvent` + per-ask `broadcast` +
   `broadcastGlobal`. Re-broadcasts only the rows Tier 1 created in
   step 4 of `writeMessage`. **It MUST NEVER call
   `inferAskFromMessage` again** — ask creation is Tier 1 (see
   `src/lib/persist/ask-writes.ts`). A replay broadcasts WS envelopes
   for existing rows; it does not create new ones.
4. **`broadcastQueue.markDone(msg.id)`** — only after every step above
   succeeded. Rows with `broadcast_state='done'` will never be
   replayed.

On exception (any step throws): `broadcastQueue.bumpAttempts(msg.id)`,
and if `broadcast_attempts >= MAX_BROADCAST_ATTEMPTS` (5), the row is
marked `'failed'`. The throw propagates so the HTTP POST handler
returns 500; the row stays `'pending'` (or `'failed'`) for the
catch-up loop to handle on next boot.

## Phase C catch-up loop

`replayPendingBroadcasts(maxAgeMs = 24h)` in
`src/lib/server/processor/catchup.ts`.

```
On boot:
  replayPendingBroadcasts() once
  setInterval(replayPendingBroadcasts, 5000).unref()

On POST /api/internal/notify-new-message:
  returns 202 Accepted immediately
  void replayPendingBroadcasts()   // dedupe via globalThis isReplaying
```

Three invariants (load-bearing — don't change without re-reading the
test suite):

1. **Replays NEVER create new asks.** `getAsksByMessage(id)` loads
   existing rows; `inferAskFromMessage` is not called.
2. **Stale messages (age >= 30s) replay with `allowPtyInject=false`.**
   Router nulls the pty-injection AND linked-chat adapters, so
   buffered chat text cannot inject into stdin.
3. **Old messages (age > maxAgeMs) are explicitly marked `'expired'`.**
   They are NOT silently skipped — the partial index would accumulate
   them forever. Default `maxAgeMs = 24h`.

The `isReplaying` flag lives on
`globalThis['__ant_catchup_state__']` so SvelteKit's hot reload and
mixed import paths share the same state. Concurrent calls return 0
immediately.

## When direct `queries.createMessage` is OK

The default `broadcastState='done'` on `queries.createMessage`
deliberately keeps non-chat system writes out of the broadcast queue.
These call sites are intentional and should NOT be migrated to
`writeMessage`:

| File:line | What it writes | Why direct |
|---|---|---|
| `src/lib/server/message-router.ts:366` | Focus-mode release digest | System message, not a user chat post |
| `src/lib/server/interview-summary.ts:52` | Interview summary message | System message, not user-authored |
| `src/lib/server/mcp-handler.ts:165` | MCP-emitted message | Has its own routing path; migration is a future phase |
| `src/routes/api/hooks/+server.ts:186-388` | Hooks-emitted assistant messages | Server-internal, fires its own broadcast inline |

If you're adding a NEW chat-message write that originates from a
user or an agent (rather than the server emitting on someone's
behalf), route it through `writeMessage` — even from server-side
handlers. The transaction wrap + auto-membership + ask creation in
one atomic operation is the contract you want.

If you're adding a NEW system event that should NEVER replay,
direct `queries.createMessage` is the right tool. Add a row in the
table above.

## Phase D direct-write JSON shape

Compared to the HTTP POST response, `postMessageDirect` returns:

```ts
{
  message: PersistedMessage,
  asks: CreatedAsk[],
  firstPost: boolean,
  isLinkedChat: boolean,
  senderResolved: { name, type },
  routingHints: { askIds },
}
```

What's **missing vs HTTP**:
- `deliveries[]` — the persist library has no visibility into the
  Tier 2 side-effect outcomes. The CLI fires `notifyServer` after the
  direct write but does not await the resulting `runSideEffects`
  run (which returns `deliveries`).
- `hint` (first-post skills hint) — emitted only by the HTTP POST
  handler's response shape.

CLI consumers that need `deliveries` should hit HTTP; agents using
direct-write get the row id and broadcast_state but not the live
delivery outcomes. The catch-up loop or `runSideEffects` running
on-server will land the WS broadcasts shortly after the CLI exits.

## Lifecycle test coverage

| Invariant | Test file |
|---|---|
| `writeMessage` rolls back on mid-transaction throw | `tests/persist-write-message.test.ts` |
| First-post detection works once per (room, sender) | `tests/messages-first-post-hint.test.ts` |
| HTTP POST flips broadcast_state to 'done' | `tests/messages-post-broadcast-state.test.ts` |
| Direct writeMessage leaves row at 'pending' | `tests/messages-post-broadcast-state.test.ts` |
| Channel fanout idempotency via delivery_log | `tests/processor-side-effects.test.ts` |
| Channel fetch awaited before markDone | `tests/processor-side-effects.test.ts` |
| Catch-up replays 3 pending rows | `tests/persist-broadcast-catchup.test.ts` |
| Catch-up marks > 24h rows as 'expired' | `tests/persist-broadcast-catchup.test.ts` |
| Concurrent replay calls dedupe | `tests/persist-broadcast-catchup.test.ts` |
| Stale linked-chat row does NOT call adapter.deliver | `tests/persist-broadcast-catchup.test.ts` |
| isReplaying singleton survives reimport | `tests/persist-broadcast-catchup.test.ts` |
| POST /api/internal/notify-new-message 202 + replay | `tests/internal-notify-endpoint.test.ts` |
| isLocalServer loopback-only predicate | `tests/cli-direct-write.test.ts` |
| writeMessage source='cli' auth gate (5 paths) | `tests/cli-direct-write.test.ts` |

74 assertions total across 10 files. If a future change breaks any
of these, the contract is changing — update this doc.
