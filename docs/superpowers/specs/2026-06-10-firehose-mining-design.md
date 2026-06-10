# Firehose Mining Pass — Design Spec (2026-06-10)

**Goal:** turn the preserved telemetry firehose (`terminal_run_events`, `cli_hook_events` in the telemetry sidecar) into durable learnings, landing in two destinations: the ObsidiANT **vault** (memory-pack lesson files) and the **knowledge graph** (via the existing graphify skill). The firehose is a transcript asset to be mined, never pruned (`project_firehose_is_an_asset_mine_before_prune`). This is the consumer of the sidecar move (`2026-06-10-telemetry-sidecar-design.md`); mining never deletes firehose rows.

**Scope (JWPK 2026-06-10): high-signal sessions only**, incremental via a watermark. Not the full 61M-event backlog up front — the backlog stays preserved and can be swept later by clearing the watermark.

## Architecture

A **skill you trigger** (`/mine-firehose`), not always-on server automation — cheaper (run on demand), reuses the agent/workflow + graphify tooling, keeps the LLM work off the live server. One run:

```
1. SELECT      high-signal sessions since the watermark (cheap SQL, no LLM)
2. RECONSTRUCT each into an ordered transcript
3. EXTRACT     a Workflow fans out one agent per session → lessons; a verifier filters
4. WRITE       memory-pack lesson files → a STAGED review area; transcripts → a folder
5. GRAPH       graphify --update on that folder → knowledge graph
6. ADVANCE     record mined sessions so the next run is incremental
```

## Components (each small + independently testable)

### Selector — `firehoseSelector.ts`
Pure SQL over the telemetry DB. A `(terminal_id, session-window)` is a candidate if it is **not already mined** AND qualifies on **any** of:
- **Errors/failures:** ≥1 classified (`kind != 'raw'`) row whose `text` matches a tuned error pattern set (`error`, `exception`, `failed`, `traceback`, `fatal`, `panic`), case-insensitive.
- **Commits/decisions:** ≥1 row with `text LIKE '%git commit%'` / `'%git merge%'` / a plan-or-milestone update, or a `cli_hook_events` Bash tool-call running those.
- **Long/sustained:** event count ≥ `ANT_MINE_MIN_EVENTS` (default 150) **or** span ≥ `ANT_MINE_MIN_SPAN_MS` (default 20 min).

Returns candidates with their qualifying signals (for the dry-run report + provenance). Tunable thresholds via env.

### Session windowing
A "session" = a terminal's contiguous activity, split on an idle gap > `ANT_MINE_SESSION_GAP_MS` (default 30 min) and anchored by `cli_hook_events` `SessionStart`/`SessionEnd` when present. The mined unit is `(terminal_id, window_start_ms, window_end_ms)` — "one agent, one stretch of work."

### Reconstruction — `sessionReconstruct.ts`
For a session window: pull its `terminal_run_events` ordered by `ts_ms`, keep the classified `message`/`thinking`/`tool_call`/`command` rows (drop raw-byte noise), interleave structured `cli_hook_events` (tool calls, cwd, lifecycle) → one readable transcript string + light metadata (terminal, handle, time range, signals). Pure function, fixture-tested. Caps transcript size (`ANT_MINE_MAX_TRANSCRIPT_BYTES`) so a pathological session can't blow the extraction context.

### Extraction — a Workflow (orchestration, not a module)
One agent per candidate session (capped concurrency). Each emits **0..N lessons** via a StructuredOutput schema mirroring the vault format: `name`, `description`, `type` (feedback|gotcha|pattern|reference), `scope`, `rule`, `why`, `howToApply`. **Emit nothing when no durable lesson exists** — quality over volume. Then:
1. **Adversarial verifier** (second agent per lesson): genuine, reusable, non-obvious — or noise/too-specific? Drops weak ones.
2. **Dedup vs existing vault** by title/description similarity, so a recurring pattern doesn't spawn near-duplicate files.

### Vault writer — staged review area
Surviving lessons are written as memory-pack `.md` files (frontmatter + `Rule:`/`Why:`/`How to apply:` body) into **`memory-pack/_mined/`** (a STAGED area, not the trusted vault root). Frontmatter carries provenance: `source: mined-from-firehose`, the session id + `ts` range, and the qualifying signals, so each lesson is auditable back to its transcript and distinguishable from human-confirmed memories. Promotion to the trusted vault is a manual skim (a one-line config flag can switch to auto-write if ever wanted — but default is gated).

### Graph feed
Reconstructed transcripts (and the surviving lessons) are written to a staging folder; mining then shells out to `/graphify <folder> --update`. graphify owns entity extraction, clustering, and the HTML/JSON/report into the vault. Mining only produces the input folder.

### Watermark — `firehose_mined_sessions` table (telemetry DB)
Records each mined `(terminal_id, window_start_ms, window_end_ms)` + mined-at. The selector excludes already-mined sessions → every run is incremental, no re-mining. A one-off backlog sweep = run with the table cleared.

## Trigger & cost control
On-demand `/mine-firehose` skill (schedulable later via /schedule once trusted). Cost bounded by: high-signal-only + watermark + capped per-session concurrency + the cheap verifier. **`/mine-firehose --dry-run`** runs selector + reconstruction and reports candidate count + rough transcript size **without any LLM extraction**, so scope/cost is visible before a real run.

## Testing
- selector: each signal flags/excludes correctly; already-mined excluded; thresholds honoured (fixture telemetry DB).
- session windowing: idle-gap split; SessionStart/End anchoring.
- reconstruction: ordered, raw-noise dropped, hook events interleaved, size cap enforced.
- watermark: mined sessions recorded + excluded on the next selector pass.
- vault writer: valid memory-pack frontmatter + provenance; lands in `_mined/`; dedup skips an existing-title lesson.
- dry-run: reports candidates, writes nothing, calls no agent.
- (extraction workflow + graphify shell-out are integration-verified manually on a real run, not unit-tested — they're orchestration/external-tool.)

## Out of scope (separate work)
- Full 61M backlog sweep (deferred; same pipeline, watermark cleared).
- Auto-promotion of mined lessons into the trusted vault (gated review is the default).
- Any change to firehose retention — mining reads, never deletes.

## Open risks
- **Extraction quality** — AI-guessed lessons can be wrong; mitigated by the verifier + the staged review gate (nothing auto-trusted).
- **Session windowing fidelity** — the idle-gap heuristic may split/merge imperfectly; SessionStart/End anchoring reduces this, and a mis-windowed session still yields a usable (if slightly ragged) transcript.
- **graphify cost/scale** on large transcript folders — bounded by high-signal-only input; graphify's `--update` keeps re-runs incremental.
