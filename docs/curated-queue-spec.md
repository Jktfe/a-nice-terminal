# Curated message queue for the local chair — build spec (2026-06-09)

**Goal (JWPK):** a capacity-gated, *curated* FIFO in front of the local chair so it never floods/melts. Two tiers: a **curator** (Perspective / small fast model) that *manages the queue and does no work* — condense, combine duplicates, drop resolved Qs/updates, triage/sort — and the **worker** (Gemma) that pulls the next curated item *at its own pace when it has capacity*, acts on rooms, occasional work. The queue is a **first-class, durable object, editable by user AND via CLI**.

## Actors on one queue
- **Inbound** — @-mentions that pass `onlyRespondTo` → `enqueue()` raw.
- **Curator (Perspective/small model)** — edits the queue in place: dedupe/coalesce, condense, drop-resolved, sort. Does NO work.
- **Worker (Gemma)** — `pullNext()` ONLY when `agentStateReader` says it's free (Waiting/Available); on done → `markDone` → pull next. One-in-flight.
- **User + CLI** — `ant queue …` + UI: list/add/edit/reorder/drop.
- **Cron** — when `countPending==0` AND worker idle → inject proactive work.
- **Delivery mode** — per terminal: `inject` pastes into the pane; `queue_raw` writes durable queue rows and runs curator mode `off`; `queue_summarise` writes durable queue rows and leaves curator mode `parse` for a summariser/worker.

## Data model — table `room_message_queue`
```
id              TEXT PRIMARY KEY        -- q_<rand>
room_id         TEXT NOT NULL
target_handle   TEXT NOT NULL           -- the chair, e.g. @localchair
source_message_ids TEXT NOT NULL        -- JSON string[] (raw msgs coalesced into this item)
curated_text    TEXT NOT NULL           -- what the worker sees (curator condenses)
kind            TEXT NOT NULL           -- 'mention' | 'cron' | 'task' | 'manual'
priority        INTEGER NOT NULL        -- lower = sooner; default = enqueue order (created_at_ms)
status          TEXT NOT NULL CHECK (status IN ('pending','working','done','dropped'))
created_at_ms   INTEGER NOT NULL
updated_at_ms   INTEGER NOT NULL
```
Index: (room_id, target_handle, status, priority, created_at_ms).

## Store API — `src/lib/server/messageQueueStore.ts`
- `enqueue({roomId,targetHandle,sourceMessageId,text,kind,priority?}) -> QueueItem`
- `listQueue(roomId,targetHandle,{status?}) -> QueueItem[]` (ordered priority,created)
- `pullNext(roomId,targetHandle) -> QueueItem | null` — atomic: next `pending` → set `working`, return it (one-in-flight: returns null if one already `working`).
- `markDone(id)` / `markDropped(id)`
- `updateItem(id,{curatedText?,priority?,status?})`
- `reorder(id,newPriority)`
- `coalesce(targetId, sourceId)` — merge source's source_message_ids into target, drop source (curator dedupe).
- `countPending(roomId,targetHandle) -> number`
- `resetForTests()`

## Curator — `src/lib/server/queueCurator.ts`
`curate(roomId, targetHandle, { mode })` over `pending` items:
1. **dedupe/coalesce** — items with identical/near-identical curated_text or overlapping intent → coalesce.
2. **condense** — v1 rule-based (trim, strip noise); seam `condenseFn` for a small model later.
3. **drop-resolved** — heuristic: a later item that supersedes/answers an earlier one → mark earlier `dropped`. v1: same-source-thread + "done/resolved" markers; conservative.
4. **sort** — stable FIFO by created, with priority override.
5. **mode `off`** — no-op pass-through; reports the real pending depth without dedupe, condense, or drop-resolved.
Pure functions where possible; model calls behind an injectable seam (NO model in tests).

## API — `src/routes/api/chat-rooms/[roomId]/queue/`
- `+server.ts`: GET (list) · POST (enqueue) — auth: same room mutation gate as messages.
- `[queueId]/+server.ts`: PATCH (edit/reorder/curate) · DELETE (drop).
- `pull/+server.ts`: POST (pullNext, gated on worker-free).

## CLI — `scripts/ant-cli.mjs`: `ant queue`
`list|add|edit|reorder|drop|pull --room ROOM [--handle @h]` — thin wrappers over the API. (Binary rebuild = deploy step, JWPK's nod.)

## Gate/consumer — `src/lib/server/queueConsumer.ts`
`maybePullForWorker(roomId, targetHandle)` — if `agentStateReader` worker state ∈ {Waiting,Available} and nothing `working`, `pullNext` + deliver to the chair pane (reuse pty-inject). On worker→Waiting transition, pull next.

## Wire inbound — `pty-inject-fanout.ts`
For a target with queue delivery enabled (`queue_raw` or `queue_summarise`), the @-mention that passes `onlyRespondTo` → `enqueue()` to the durable queue INSTEAD of direct inject. The consumer/gate releases it when the worker's free. `queue_raw` defaults `/queue/curate` to mode `off`; `queue_summarise` defaults to mode `parse`.

## Box-safety
Store/curator/API/CLI/tests are MODEL-FREE (rule-based + injectable seams + mocks). Only a final capped demo touches a model (32K ctx). No 131K, ever.

## Build order
1. store + tests  2. curator + tests  3. API + tests  4. consumer/gate + tests  5. CLI verbs  6. inbound wire  7. green (vitest+svelte-check)  8. demo  9. adversarial-verify. UI + Perspective-process + cron = layer after the spine is green.
