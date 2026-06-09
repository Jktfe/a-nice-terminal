# Curated chair queue — delivery (2026-06-09, autonomous build)

**What you asked for:** a capacity-gated, *curated* FIFO in front of the local chair so it never floods/melts — a curator (Perspective/small model) that *manages* the queue (condense, dedupe, drop-resolved, sort) and does no work, and a worker (Gemma) that pulls one-in-flight at its own pace. Editable by user + CLI. **Status: built, tested, demonstrated working. Branch `feat/curated-queue` (not merged).**

## It works — proof
- **Unit:** 80 tests green (store 33 · reclaim 3 · curator 14 · consumer 8 · API 22) + `svelte-check` **0 errors / 4545 files**.
- **End-to-end (real model):** `curatedQueue.demo.test.ts` runs the full loop against **gemma4-chair**: enqueue 5 (incl. a dup) → curate (coalesced the dup → `dropped`) → capacity-gated pull (the **one-in-flight guard held on every iteration** — 2nd pull always `null`) → gemma4-chair responds → `done` → next, until all done. Output saved at `/tmp/curated-queue-demo.txt`.
- **No regression:** existing fanout suite 53/53 with the inbound-wire added.

## The operational fix (the model now holds)
The meltdown was the model loaded at **131K context = ~68 GB** (KV cache, not weights). Fixed: **`gemma4-chair`** = `gemma4:12b-mlx` capped at `num_ctx 32768` → **10 GB footprint**, box load ~8. Create it with:
```
ollama create gemma4-chair -f -  <<'EOF'
FROM gemma4:12b-mlx
PARAMETER num_ctx 32768
EOF
```
**Chair system prompt** (fixes the "I'm furniture" misread — verified): 
> "You are @localchair, an AI coordinator for an ANT multi-agent chat room. You are NOT furniture. Your job: briefly acknowledge/route/summarise. Reply in ONE concise sentence."
With that prompt it behaves correctly ("I am routing this to the Engineering Agent…", "Acknowledged; removed from the active agenda.").

## Architecture (what's in the branch)
- `src/lib/server/messageQueueStore.ts` — durable, editable queue (`room_message_queue` table). enqueue / listQueue / **pullNext (atomic, one-in-flight)** / markDone / markDropped / updateItem / reorder / coalesce / countPending.
- `src/lib/server/queueCurator.ts` — `curate()`: dedupe (Jaccard ≥0.9, conservative) · condense (rule-based + injectable `condenseFn` seam) · drop-resolved (conservative, separate 0.5 subject threshold). Model-free; `condenseFn` is where `perspective --fm` (Apple Foundation Models, off-GPU) plugs in.
- `src/lib/server/queueConsumer.ts` — `maybePullForWorker()`: the capacity gate. Pulls only when the worker is FREE (agentStateReader, injectable) AND nothing is `working`.
- API: `/api/chat-rooms/[roomId]/queue` (GET list · POST enqueue) · `/[queueId]` (PATCH edit/reorder · DELETE drop) · `/pull` (POST) · `/curate` (POST). All mutations behind `requireChatRoomMutationAuth`.
- CLI: `ant queue list|add|edit|reorder|drop|pull` (`scripts/ant-cli-queue.mjs`, wired into `ant-cli.mjs`) — editable via CLI. *(Binary rebuild = deploy step.)*
- Inbound wire: `pty-inject-fanout.ts` — **flag-gated** (`meta.queueEnabled===true`). Default-off = every other terminal unchanged. Best-effort (falls through to direct inject on any error).
- Runtime: `scripts/curated-queue-poller.mjs` — curates + releases one item to the chair pane only when it's free. **`--dry-run` by default; `--live` required to drive the pane.**

## Go-live recipe (your call — the gated steps)
1. Ensure `gemma4-chair` loaded (above) and run the chair with the system prompt:
   `pi --provider ollama --model gemma4-chair --thinking off -nc` in the chair pane.
2. Enable the queue for the chair terminal: set `meta.queueEnabled=true` on `t_i83p2t5sqr` (via the terminal settings API/UI, or the same DB path used for `onlyRespondTo`).
3. Run the poller against a worktree dev server (it serves the new routes):
   `node scripts/curated-queue-poller.mjs --room <ROOM> --handle @localchair --pane t_i83p2t5sqr:0.0 --once` (dry-run first; add `--live` when happy).

## Honest caveats
- **Curator is conservative** — in the demo it coalesced only the *exact* duplicate, not the near-dup or the resolve (by design: false-drops are worse than a slightly longer queue). Thresholds are one-line tunable.
- **Poller not run live yet** — its components are tested (API 22 / consumer 8 / curate endpoint); a live dry-run needs the worktree dev server (step 3). I did not enable `--live` autonomously.
- **`perspective --fm` as the off-GPU AFM curator** is wired only as the `condenseFn` seam — not yet invoked (v2; needs Apple Intelligence enabled).
- **Not merged to main, binary not rebuilt** — both your gated go-live steps.

## Adversarial review (done — all findings fixed, commit `1590a18`)
A separate agent stress-tested the spine end-to-end through the real HTTP surface and runtime loop. Every finding is fixed and re-verified (80 tests green, svelte-check 0 errors):

| # | Finding | Fix |
|---|---------|-----|
| H1 | A chair that dies mid-item leaves a stuck `working` row that blocks every future pull forever | `reclaimStaleWorking` (commit `5cd7fbd`); curate reclaims on the live path; `maybePullForWorker` takes opt-in `reclaimStaleMs` so the direct-module path also un-stalls |
| H2 | Poller marked an item `done` prematurely — a local model that hasn't flipped to `working` yet still reads *free*, so the in-flight item got skipped | Dwell guard: mark done only once the chair is observed busy-since-delivery **then** free, or a `--max-dwell` (180 s) fallback elapses |
| M1 | `GET /queue` was open — leaked routed message bodies (`curatedText`) unauthenticated | Read-gated via `requireChatRoomReadAccess`, like the messages endpoint |
| M2 | `PATCH …/{id}` could set `status='working'`, creating a second in-flight item and sidestepping one-in-flight | PATCH rejects `working` (claimed only by atomic `pullNext`) |
| M3 | `coalesce` dropped the source `curatedText` on a non-containment merge — silent data loss | Source text appended (with a containment guard so no redundant dup) |
| L1 | Poller `--dry-run` still mutated the queue (curate/pull/patch) | Dry-run is now side-effect-free — logs "would …" only |
| L2 | Poller `isFree` included `idle` (the post-delivery state feeding the H2 race) | Aligned to `waiting`/`available`, matching `queueConsumer.FREE_LABELS` |
| L3 | `/curate` validated the body before auth → 400-vs-401 contract probing | Auth before field validation |
