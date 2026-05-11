# Three-tier refactor: persist / process / visualize

> **Citations note.** Line numbers below are anchored to `origin/main` at
> the time of writing (post `fc95208`) and will drift as code lands. The
> *structural* references — file paths, function names, table names,
> column names — are the durable source of truth. If you find a cite
> off by a few lines, trust the structure and the grep; the implementer
> for each phase is expected to re-pin line numbers in their commit
> message rather than chase them in this doc.

## Context

The CLI (`ant chat send …`) currently cannot send messages when the SvelteKit server is offline. Today it POSTs to `/api/sessions/<id>/messages` — the main send at `cli/commands/chat.ts:358`, the file-share variant at `cli/commands/chat.ts:172`, and the linked-chat variant at `cli/commands/chat.ts:393` (all flow through `cli/lib/api.ts:47`); if the fetch fails the CLI exits with an error and the message is dropped — no local queue, no DB write. The database (`~/.ant-v3/ant.db`, WAL mode at `src/lib/server/db.ts:102`, `busy_timeout=5000` at line 104) lives on the server side only.

The user wants a cleaner architecture, not just an offline patch — a **data server** and a **visual server** as separable concerns. Also explicitly: the current CLI is slow because every send is a full HTTP round-trip to a SvelteKit server that runs all 17 POST-handler steps synchronously; and the CLI should integrate better with other terminals on the host.

1. **Tier 1 — Persistence (data plane).** Any process (CLI, server, MCP, terminal channel, future tools) writes messages to SQLite via a shared library. Deterministic, idempotent, no network hop.
2. **Tier 2 — Data server (processor / fan-out).** Validates routing decisions, broadcasts to WS subscribers, injects into agent PTYs, calls channel webhooks (including `ant-channel.ts` on remote hosts). Owns in-memory live state. If it's down, Tier-1 writes still succeed; live broadcasts are replayed when it boots.
3. **Tier 3 — Visual server.** SvelteKit UI. Reads from DB, subscribes to Tier 2 events. Killable / restartable / re-skinnable without affecting the data plane.

**Performance angle.** Today `ant chat send` pays: TCP connect + TLS (if remote) + HTTP parse + SvelteKit route dispatch + 17 sequential steps + JSON response + connection close. Direct DB writes via Tier 1 drop that to one SQLite `INSERT` transaction (sub-ms on local WAL) and a fire-and-forget notify. The server-side processing (asks inference, channel fanout, WS broadcast) still happens — but it no longer blocks the CLI's exit.

**Terminal integration angle.** Once any process can write through Tier 1, terminal-side integrations (`ant-capture`, `ant-probe`, `ant-channel`, future shell hooks) can post events directly without an HTTP server detour. The data server picks them up via the same `broadcast_state='pending'` handoff and fans out.

Today the POST handler at `src/routes/api/sessions/[id]/messages/+server.ts:130-481` mashes all three concerns into one path. ~11 of the steps are pure DB mutations (replicable in any process); ~6 are in-memory side-effects that only the live server can execute (WS broadcast at `+server.ts:442-454`, channel HTTP fanout at `+server.ts:414-440`, agent event bus emission at `+server.ts:459`, global ask broadcast at `+server.ts:461`, focus queue at `message-router.ts:544-550`, PTY injection at `message-router.ts`).

This refactor splits them, with a `broadcast_state` column on `messages` serving as the handoff: Tier 1 inserts with `'pending'`; Tier 2 flips to `'done'` after running side-effects, and replays anything still `'pending'` on startup. Immediate outcome: CLI can write directly to the local DB even when the server is offline, and the server catches up the live fan-out when it returns.

## Architecture

```
┌──────────────┐    ┌──────────────────────┐     ┌────────────────┐
│  CLI / MCP   │───▶│  Tier 1: persist lib │────▶│  SQLite (WAL)  │
│  (or HTTP)   │    │  writeMessage()      │     │  broadcast_    │
└──────────────┘    └──────────────────────┘     │  state column  │
                                ▲                 └────────┬───────┘
                                │                          │
                                │ best-effort notify       │ poll/replay
                                ▼                          ▼
                       ┌──────────────────────────────────────────┐
                       │  Tier 2: processor                       │
                       │  runSideEffects() + replayPending()      │
                       │   • WS broadcast • PTY inject            │
                       │   • channel fanout • ask event bus       │
                       └──────────────────────┬───────────────────┘
                                              │  WS events
                                              ▼
                                  ┌────────────────────────┐
                                  │  Tier 3: SvelteKit UI  │
                                  └────────────────────────┘
```

Tier 2 lives **inside the SvelteKit server process for now** (Phase A–D). A later phase can extract it to a separate daemon without changing Tier 1.

## File changes

### New: Tier 1 — persist library
- `src/lib/persist/index.ts` — barrel export.
- `src/lib/persist/types.ts` — `MessageInput`, `WriteMessageResult`.
- `src/lib/persist/normalize-input.ts` — mention boundary (currently `+server.ts:139`), meta JSON parse, urgent-reason check (`+server.ts:157-164`).
- `src/lib/persist/write-message.ts` — main orchestrator. Wraps `db.transaction()`. Runs: input normalization → ask inference (reuses `inferAsks` from existing `ask-inference.ts:42-72`) → `queries.createMessage(... broadcast_state='pending')` → session touch (`+server.ts:241`) → explicit/inferred ask row writes (`+server.ts:271-289`) → consent-gate on inferred asks (`+server.ts:374`) → meta rewrite with `ask_ids` (`+server.ts:351-362`) → `queries.addRoomMember` upsert (`+server.ts:390-401`).
- `src/lib/persist/ask-writes.ts` — extracted ask-row creation + consent-gate path; wraps existing `inferAskFromMessage` and `consentGateAsk` (already pure).
- `src/lib/persist/room-membership.ts` — thin wrapper around `queries.addRoomMember`.
- `src/lib/persist/broadcast-queue.ts` — `markPending`, `markDone`, `markFailed`, `listPending(limit)`.

### New: Tier 2 — processor
- `src/lib/server/processor/run-side-effects.ts` — Tier-2 entry point. Consumes a `WriteMessageResult` (or reconstructs one from a DB row during replay). Runs: channel HTTP fanout (`+server.ts:414-440`), `messageRouter.route()` (`+server.ts:442-454` → `message-router.ts:481-498`), agent event bus emit (`+server.ts:459`), global ask broadcast (`+server.ts:461`). On success, calls `markDone(msgId)`. On exception, increments `broadcast_attempts`; after 5, marks `'failed'`.
- `src/lib/server/processor/catchup.ts` — `replayPendingBroadcasts(maxAgeMs?)`. Loads pending rows (use partial index), reconstructs context (sender resolution, linked-chat detection), invokes `runSideEffects` with replay-mode flags (see Risks). Messages whose age exceeds `maxAgeMs` are **explicitly marked `'expired'`** in the same scan rather than skipped — otherwise they'd accumulate in the partial index forever. Default `maxAgeMs = 24h`. Guards against concurrent runs via a process-local `isReplaying` flag; if a previous cycle is still in flight when the interval poller fires, the new tick is a no-op.
- `src/routes/api/internal/notify-new-message/+server.ts` — `POST { id }` endpoint. `assertCanWrite` gates auth. Loads the message, calls `runSideEffects`. CLI fires this best-effort after a successful direct DB write so live viewers see the message immediately when the server is up.

### Modify
- **`src/lib/server/db.ts`** — at line 235 (next to the `pinned` migration), add:
  ```ts
  if (!msgCols.includes('broadcast_state'))
    G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN broadcast_state TEXT DEFAULT 'done'`);
  if (!msgCols.includes('broadcast_attempts'))
    G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN broadcast_attempts INTEGER DEFAULT 0`);
  ```
  Default `'done'` so existing rows are NOT replayed. New rows get `'pending'` explicitly via `createMessage`. Add partial index:
  ```ts
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_messages_broadcast_pending
    ON messages(broadcast_state) WHERE broadcast_state='pending'`);
  ```
  Extend `queries.createMessage` (around line 1073) to accept and write `broadcast_state` (default `'pending'`). Add `queries.markBroadcastDone`, `queries.markBroadcastFailed`, `queries.listPendingBroadcasts`.

- **`src/routes/api/sessions/[id]/messages/+server.ts`** — POST handler shrinks to ~30 lines:
  ```ts
  assertCanWrite(event);
  const input = await parseInput(event);             // existing field extraction
  if (input.msgType === 'agent_response') return handleAgentResponse(...); // unchanged
  const result = writeMessage(input);                // Tier 1
  const deliveries = await runSideEffects(result);   // Tier 2
  return json({ ...result.message, deliveries, ... });
  ```
  Keep PATCH/DELETE handlers as-is (they already only touch DB + ws-broadcast).

- **`cli/lib/api.ts`** — add:
  ```ts
  export async function postMessageDirect(input: MessageInput): Promise<WriteMessageResult> {
    const { writeMessage } = await import('../../src/lib/persist/write-message.js');
    return writeMessage({ ...input, source: 'cli' });
  }
  export async function notifyServer(ctx: Ctx, msgId: string): Promise<void> {
    try {
      await fetch(`${ctx.serverUrl}/api/internal/notify-new-message?id=${msgId}`, {
        method: 'POST',
        headers: ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {},
        signal: AbortSignal.timeout(500),
      });
    } catch {}
  }
  ```

- **`isLocalServer(serverUrl)` — new helper in `cli/lib/api.ts`.** The CLI's direct-write branch fires only when the target server is on the same host AS THE PROCESS WRITING TO ant.db. The predicate is intentionally narrow:

  ```ts
  export function isLocalServer(serverUrl: string): boolean {
    try {
      const u = new URL(serverUrl);
      const host = u.hostname.toLowerCase();
      // Loopback addresses
      if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return true;
      // mDNS .local hostnames resolve via the local Bonjour responder; they
      // CAN be a different physical host on the LAN. Excluded by default so
      // a CLI on one Mac does not direct-write to a sibling's ant.db.
      // Tailscale (.ts.net) is explicitly NOT local — the host's filesystem
      // is not addressable from a different node on the tailnet even though
      // the URL looks reachable. Tailscale callers go through HTTP.
      return false;
    } catch {
      return false;
    }
  }
  ```

  The rule: direct-write requires *the same kernel writing to the same ant.db file*. Anything that traverses a network — including `.ts.net`, `.local`, LAN IPs, public domains — keeps the HTTP path. Misclassifying a tailnet peer as "local" would silently split-brain the database.

- **`cli/commands/chat.ts:358`** — replace the main `api.post(…/messages…)` with a helper (and mirror the same branch in `sendFileMessage` at `:172` and the linked-chat post at `:393`):
  ```ts
  const isLocal = isLocalServer(ctx.serverUrl);
  if (isLocal && !roomToken) {
    const r = await postMessageDirect({ sessionId: args.roomId, role, content, ... });
    await notifyServer(ctx, r.message.id);  // bounded by AbortSignal.timeout(500) in notifyServer
    return r.message;
  }
  return api.post(ctx, `/api/sessions/${args.roomId}/messages`, payload, roomOpts);
  ```
  Remote rooms (non-localhost, or room-scoped tokens) keep the HTTP path — direct DB writes are local-only.

  **Why `await` (rejecting the earlier "fire-and-forget" framing).** In Node, a CLI returning to top-level can exit before an unawaited `fetch` flushes its socket write — the message would land in the DB but the live broadcast wouldn't fire until the 5s catch-up poller. Awaiting is bounded by `AbortSignal.timeout(500)` inside `notifyServer`, so the worst case (server unreachable) adds 500ms; the typical case (server up, endpoint returns 202 immediately — see below) is ~5–20ms. Either way still faster than today's ~30–80ms HTTP path, and we never silently drop the live broadcast.

  **`/api/internal/notify-new-message` returns 202 Accepted immediately** after enqueuing the work onto the same in-process queue Tier 2 uses for catch-up. That keeps the CLI's awaited round-trip cheap and decouples broadcast latency from CLI exit.

- **`server.ts`** — after agent-event-bus `init()` (~line 1241), add:
  ```ts
  import('./src/lib/server/processor/catchup.js').then(({ replayPendingBroadcasts }) => {
    replayPendingBroadcasts().then((n) => {
      if (n > 0) console.log(`[catchup] replayed ${n} offline messages`);
    });
    setInterval(() => replayPendingBroadcasts().catch(() => {}), 5000).unref();
  }).catch(() => {});
  ```
  `replayPendingBroadcasts` carries its own `isReplaying` module-level flag and returns 0 immediately if a previous cycle is still running, so overlapping ticks from this interval (or from the `/api/internal/notify-new-message` path) cannot double-process the same row. The 5s poller is a backstop in case the CLI's notify call is lost; cheap thanks to the partial index.

## Key function signatures

```ts
// src/lib/persist/types.ts
export interface MessageInput {
  sessionId: string;
  role: string;
  content: string;
  format?: string;
  senderId?: string | null;
  target?: string | null;
  replyTo?: string | null;
  msgType?: string;
  meta?: Record<string, any> | string;
  asks?: string[];
  // `source` identifies the caller of writeMessage(). The value is stored
  // on the message row's meta for provenance and gates the direct-write
  // authorization path (see Risks → Authorization). `'replay'` is NOT a
  // valid input to writeMessage — replays act on existing rows via
  // runSideEffects({replay:true}); the union below intentionally omits it.
  source: 'http' | 'cli' | 'mcp';
}

export interface WriteMessageResult {
  message: { id; session_id; role; content; format; status; sender_id;
             target; reply_to; msg_type; meta; created_at; broadcast_state };
  asks: any[];
  firstPost: boolean;
  isLinkedChat: boolean;
  senderResolved: { name: string; type: string | null };
  routingHints: { allowPtyInject: boolean; askIds: string[] };  // channel fanout uses delivery_log idempotency, no time gate
}

// src/lib/persist/write-message.ts
export function writeMessage(input: MessageInput): WriteMessageResult;  // sync; better-sqlite3 is sync

// src/lib/server/processor/run-side-effects.ts
export async function runSideEffects(
  result: WriteMessageResult,
  opts?: { replay?: boolean }
): Promise<{ deliveries: any[] }>;

// src/lib/server/processor/catchup.ts
export async function replayPendingBroadcasts(maxAgeMs?: number): Promise<number>;
```

## Phased rollout — each phase ships independently

**Phases land in order.** A unlocks B (B imports `WriteMessageResult` from A); B unlocks C (C imports `runSideEffects` from B); C unlocks D (D needs the notify endpoint and the catch-up loop in place before the CLI can rely on them). What "independently shippable" means here is that each phase produces a working, reviewable, revertable PR — *not* that A and B can be developed in parallel by two contributors. Concurrent work on A and B risks drift on the `WriteMessageResult` contract; the cap-2 protocol should keep one contributor on each phase at a time.

**Phase A — Extract persist lib (no behavior change).**
1. Add `broadcast_state` + `broadcast_attempts` columns + partial index in `src/lib/server/db.ts:230-235`.
2. Create `src/lib/persist/*` files. Move logic verbatim from `+server.ts:130-401`.
3. Rewrite POST handler to call `writeMessage` then inline the existing side-effect block. Existing tests must pass unchanged.

**Phase B — Extract Tier 2 side-effects.**
1. Create `src/lib/server/processor/run-side-effects.ts` from `+server.ts:403-463`.
2. POST handler becomes `writeMessage(input)` → `runSideEffects(result)`.
3. `runSideEffects` flips `broadcast_state='done'` on success.

**Phase C — Catch-up + internal notify endpoint.**
1. Implement `replayPendingBroadcasts()` and wire to `server.ts` startup.
2. Add `/api/internal/notify-new-message` route.
3. Add 5s interval backstop poller.

**Phase D — CLI direct-write path.**
1. Add `postMessageDirect` + `notifyServer` to `cli/lib/api.ts`.
2. Modify `cli/commands/chat.ts:171-172` to branch on `isLocalServer && !roomToken`.
3. Update `sendFileMessage` similarly (after upload succeeds — uploads still need the server).

**Phase E — Documentation & cleanup.** Update `AGENTS.md` with the tier boundary; document that anything touching in-memory state belongs in Tier 2.

## Critical files to modify
- `src/routes/api/sessions/[id]/messages/+server.ts` (POST handler refactor)
- `src/lib/server/db.ts:230-242` (schema migration + new queries)
- `cli/lib/api.ts` (direct-write + notify helpers)
- `cli/commands/chat.ts:171-172` (branch on local server)
- `server.ts` (startup catch-up)

## Existing code to reuse — do NOT re-implement
- `inferAsks(...)` — `src/lib/server/ask-inference.ts:42-72`
- `inferAskFromMessage(...)`, `consentGateAsk(...)` — already pure
- `ensureTrailingMentionBoundary(...)` — already pure
- `queries.createMessage`, `queries.addRoomMember`, `queries.hasPriorMessageFromSender`, `queries.getMessage` — `src/lib/server/db.ts`
- `messageRouter.route(...)` — `src/lib/server/message-router.ts:481-498`
- `assertCanWrite(event)` — `src/lib/server/room-scope.ts:60-67`

## Risks & mitigations

- **Channel HTTP fanout is non-idempotent** (`+server.ts:414-440` posts to port 8789). Replays could double-post — particularly if Tier 2 crashes mid-side-effect, before `markBroadcastDone` runs but after the channel POST landed. **Mitigation:** reuse the existing `delivery_log` table (`db.ts:188-197`, columns `message_id, adapter, delivered`). Before each adapter call, `runSideEffects` checks `SELECT 1 FROM delivery_log WHERE message_id=? AND adapter=? AND delivered=1`; if present, the adapter call is skipped. After a successful adapter call it inserts `(message_id, adapter, delivered=1)`. This makes replay safe at any age — no time-based heuristic needed for channel fanout. The earlier 60s `routingHints.allowChannelFanout` cutoff is dropped in favour of this per-adapter idempotency check.
- **PTY injection of stale messages.** `messageRouter.route` injects content into running agent PTYs (`message-router.ts:481-498`). Replaying a 6-hour-old message would inject stale input. **Mitigation:** `routingHints.allowPtyInject = (ageMs < 30_000)`; replay-mode skips terminal_session deliveries beyond that threshold.
- **WS broadcast double-fire.** Less harmful — browser clients already dedupe by message id, but explicit: replays still broadcast WS events.
- **SQLite cross-process writes.** WAL mode + `busy_timeout=5000` already in place (`db.ts:95-97`). Risk is the FTS triggers (`db.ts:248-258`) firing from both processes. `better-sqlite3`/`bun:sqlite` handle this safely under WAL, but verify with `tests/integration/cli-server-offline.test.ts` (see below).
- **Authorization for direct-write.** HTTP enforces `assertCanWrite` via bearer token kind (`room-scope.ts:27`). CLI direct-write bypasses HTTP entirely, so the persist lib must enforce an equivalent gate for `source: 'cli'`. Filesystem permissions on `~/.ant-v3/` are necessary but not sufficient — the same logged-in user owns multiple rooms with different membership rules, so a per-write check is required.

  **Mitigation:** `writeMessage` with `source: 'cli'` runs three checks before insert:

  1. **Caller identity.** Resolve the CLI actor from `~/.ant/identity` (handle file written by `ant register --handle @x`); if absent, default to the unauthenticated `cli` actor and treat the call as anonymous.
  2. **Room membership.** Look up `chat_room_members.WHERE room_id=? AND session_id=? OR handle=?`; if the resolved actor is not a member of the target room, the write is rejected with the same error shape `assertCanWrite` produces for HTTP bearer failures. Owner-room writes (`sessions.owner_session_id = caller_session_id`) skip the membership check, matching HTTP semantics.
  3. **Source-validity.** `source` must be one of the values the persist lib accepts (see the next clarification). `source: 'cli'` from a non-local hostname (e.g. an SSH'd-in shell pointing at a remote server URL) is rejected because the predicate above already filters those out in `cli/commands/chat.ts`; this is a belt-and-braces second check inside `writeMessage`.

  Remote rooms (room-scoped tokens, non-localhost server URLs) keep the HTTP path and inherit the existing `assertCanWrite` flow unchanged.
- **Module resolution from CLI into `src/lib/persist`.** CLI has its own `tsconfig`. **Mitigation:** keep persist as `.ts`; `tsx`/`bun` resolves cross-package paths. Verify with the CLI build pipeline (`cli/index.ts`) before merging Phase D.
- **`agent_response` path is special** (`+server.ts:166-218`). Keep it in the HTTP handler — it depends on `handleResponse()` which holds in-memory event-bus state. Tier 1 will not handle it.
- **Ask creation is Tier 1, ask broadcast is Tier 2.** `inferAskFromMessage` and the consent-gate path live in `src/lib/persist/ask-writes.ts` — ask rows are written in the same DB transaction as the message they belong to, so a partial state (message in DB, ask missing) is impossible. `runSideEffects` only re-*broadcasts* the WS `ask_created` envelope on the message's already-created ask rows; it must NEVER call `inferAskFromMessage` again. The replay path explicitly skips ask inference: a 6h-old pending row that's been replayed wakes the live view via WS but does not create a second ask row. This is load-bearing — a Tier-2 contributor adding "let's just re-run inference for safety" would introduce a silent duplicate-ask bug.

## Verification

Run after each phase:
- `npm test` (or `bun test`) — existing unit tests under `tests/`.
- `npm run test:integration` — `vitest.integration.config.ts`.

Phase-A specific:
- `tests/persist-write-message.test.ts` (new) — pure DB write; assert `broadcast_state='pending'`; ask rows created; meta rewritten with `ask_ids`.
- Existing `tests/messages-first-post-hint.test.ts`, `tests/session-messages-mention-boundary.test.ts`, `tests/consent-gate-ask.test.ts`, `tests/asks-inference.test.ts` — must pass unchanged.

Phase-C specific:
- `tests/persist-broadcast-catchup.test.ts` (new) — insert 3 pending rows, call `replayPendingBroadcasts`, assert `runSideEffects` called and `broadcast_state` flipped to `'done'`.
- `tests/internal-notify-endpoint.test.ts` (new) — POST `/api/internal/notify-new-message` with a freshly-written pending message; assert flag cleared.

Phase-D specific:
- `tests/cli-direct-write.test.ts` (new) — set `ANT_DATA_DIR` to temp; point CLI at unreachable server URL; verify message lands in DB anyway.
- `tests/integration/cli-server-offline.test.ts` (new) — kill server, run `ant chat send`, restart server, assert WS subscriber sees the message within 5s.

End-to-end smoke:
1. `npm run dev` to start the SvelteKit server.
2. Open a chat room in the browser, subscribe to WS.
3. `kill $(pgrep -f "vite dev")`.
4. `./antchat send <room-id> "offline message"` — should exit 0.
5. `sqlite3 ~/.ant-v3/ant.db "SELECT id, broadcast_state FROM messages WHERE content='offline message'"` — expect `pending`.
6. `npm run dev` again. Within 5s, the browser receives the message and the row flips to `done`.

## Expected speed impact

| Operation                  | Today                                 | After Phase D                          |
|---------------------------|---------------------------------------|----------------------------------------|
| `ant chat send` (local)   | ~30–80ms (HTTP + 17 steps in handler) | <5ms (SQLite insert + async notify)    |
| `ant chat send` (offline) | fails (exit 1)                        | <5ms, replayed when server boots       |
| `ant-probe`/`ant-capture` writing events | HTTP (where used) | Direct Tier-1 write, same <5ms profile |

The visible-to-user latency drops because Tier 2 work moves off the CLI's critical path. Total work done on the box is unchanged (or slightly less due to no HTTP framing).

## Out of scope (follow-up, once the three tiers are stable)
- **Extracting Tier 2 (data server) into a standalone daemon process.** Today it still lives in the SvelteKit server. After this refactor it's a self-contained module that could be lifted out into `bin/ant-data-server` with no API changes for Tier 1 callers. That unlocks: visual server restarts without dropping WS subscribers; running the data server on a different host from the UI; multiple visual servers (web, TUI, native) sharing one data plane.
- **Terminal-side direct writes.** `ant-capture`, `ant-probe`, and `ant-channel.ts` migrate to Tier 1 writes for events they currently HTTP-POST, eliminating another set of round-trips and enabling capture-while-offline.
- A `messages.broadcast_failed_reason` column for richer diagnostics.
- A `tail -f`-style WS bridge for the CLI that doesn't require the visual server (subscribe to Tier 2 directly).
