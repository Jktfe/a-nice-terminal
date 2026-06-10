# Telemetry Sidecar — Design Spec (2026-06-10)

**Goal:** move the telemetry firehose (`terminal_run_events`, `cli_hook_events`) out of the hot `fresh-ant.db` into its own SQLite file, eliminating the write-lock contention / 1.5–7 s read stalls, **without deleting any data and with zero downtime** (Approach B, JWPK 2026-06-10). The firehose is a transcript asset to be mined later — see `project_firehose_is_an_asset_mine_before_prune`. Mining is a separate, later spec; this spec is the move only.

## Components

### `telemetryDb.ts` (new)
- `getTelemetryDb()` opens `new Database(ANT_TELEMETRY_DB_PATH)` (default: sibling of `ANT_FRESH_DB_PATH`, i.e. `~/.ant/telemetry.db`; in tests, a sibling of the per-worker fresh DB so isolation holds), with the same WAL/pragma setup `getIdentityDb()` uses.
- Owns a self-contained migration creating `terminal_run_events` + `cli_hook_events` (DDL moved verbatim from `db.ts` — behaviour-preserving; no schema improvements in this move).
- `resetTelemetryDbForTests()` mirrors the identity-DB test reset.

### Cutover flag — `ANT_TELEMETRY_SIDECAR` (`off` | `on`, default `off`)
- `off`: every store reads/writes the identity DB exactly as today (the merge changes nothing in prod until deliberately flipped). 
- `on`: writes go to the telemetry DB; reads union(identity-DB old rows, telemetry-DB new rows).
- One accessor, `telemetrySidecarEnabled()`, gates the behaviour. Reversible at any time by flipping back to `off`.

### Write redirect
All telemetry writes funnel through `terminalRunEventsStore.appendTerminalRunEvent` and `cliHookEventsStore.insertCliHookEvent` (the codex/pi/OTLP adapters call these). Each store picks its handle: `telemetrySidecarEnabled() ? getTelemetryDb() : getIdentityDb()`. That single switch is the cutover.

### Read redirect (dual-read while flag on)
The read functions (`listLatestTerminalRunEvents`, `listTerminalRunEventsSince`, `searchTerminalRunEvents`, `cliHookEventsStore` reads, `terminalRunEventsBoot`) query the telemetry DB, and — while the flag is on AND the identity DB's copy still has rows — also query the identity DB and merge (ordered by `ts_ms`/`id`, dedup by primary key). The backfill copies-then-deletes per batch in one transaction, so each row is in exactly one file; the union never double-counts. After the source drains, the union branch returns nothing and is removed in Phase 3.

### JOIN refactor — `agentFleetStore.loadHandleWorkspaces`
Today: `SELECT tr.handle, tre.payload FROM terminal_records tr JOIN terminal_run_events tre ON tre.terminal_id = tr.session_id WHERE tr.handle IN (…) AND tre.deleted_at_ms IS NULL ORDER BY tre.ts_ms DESC`, taking the first (latest) payload.cwd per handle.
Refactor into three steps that work across two handles:
1. identity DB: `SELECT handle, session_id FROM terminal_records WHERE handle IN (…)` → handle → session_ids.
2. telemetry DB (or dual): latest non-deleted run-event payload per `terminal_id IN (session_ids)`, newest first.
3. JS join: for each handle, pick the newest event across its session_ids, parse `payload.cwd`.
Behaviour-preserving; a test asserts the JS join matches the old SQL result on a fixture.

### Backfill (Phase 2) — out-of-process, batched, resumable
A standalone node script (run with the v22 toolchain, like the existing WAL-checkpoint child) copies rows identity-DB → telemetry-DB in batches of N (e.g. 50k), each batch in a single transaction: `INSERT INTO telemetry … SELECT … FROM identity WHERE id BETWEEN ? AND ?` then `DELETE FROM identity … same range`. Resumable via the min(id) remaining. Idempotent. Runs against the live DBs but in its own process so it never blocks the server. Logs progress + what's left.

### Retention / checkpoint retarget
`operationalRetention`'s WAL-checkpoint child currently targets the identity DB file. Once the firehose lives in the telemetry file, point the checkpoint at the telemetry DB path (that's where the WAL now grows). Keep it checkpoint-only (no row deletes — per the firehose-is-an-asset rule).

## Phases (each independently shippable + reversible)
- **Phase 1 (code, this branch):** `telemetryDb.ts` + flag + write redirect + dual-read + JOIN refactor + retention retarget. Fully tested. Default flag `off` → no prod behaviour change on merge.
- **Phase 2 (operational, JWPK runs):** flip `ANT_TELEMETRY_SIDECAR=on` in prod (instant relief — new writes leave the hot DB), then run the backfill script to drain the 61M old rows.
- **Phase 3 (operational + small code):** once drained, `VACUUM` the identity DB (out-of-process) → 11 GB → MBs; drop the now-empty `terminal_run_events`/`cli_hook_events` DDL from `db.ts`; remove the dual-read union branch.

## Testing
- `telemetryDb` opens + migrates; reset isolation.
- store write lands in telemetry DB when flag on; identity DB when off.
- dual-read union merges old+new with no duplicates; returns identity-only when flag off.
- JOIN refactor matches the old SQL result on a fixture (handles → cwd).
- backfill batch: rows move (present in dest, absent in source), no loss/dup, resumable from a partial run.
- retention checkpoint targets the telemetry path when flag on.

## Rollback
Flip `ANT_TELEMETRY_SIDECAR=off` → writes/reads return to the identity DB. Any rows already in the telemetry DB stay there; a reverse-backfill (telemetry→identity) is the symmetric script if a full revert is ever needed. Nothing is deleted from source until confirmed copied (Phase 2), and the VACUUM (Phase 3) only runs after drain is verified.

## Out of scope (separate specs)
- Mining the firehose into the vault + knowledge graph (the next spec).
- Schema improvements (FTS for `searchTerminalRunEvents`, fixing the near-useless `transcript_event_id` dedupe index) — deliberately deferred so the move stays behaviour-preserving.
