# M1 Capture-Coverage Baseline

Date: 2026-05-05
Status: Failing — 6 of 8 expected event-types reliably captured.
Window: last 7 days (2026-04-28 → 2026-05-05) of the live `~/.ant-v3/ant.db`.

## Method

The M1 test reads: "Capture-coverage baseline covers prompts, asks, plans, file writes, artifact writes, screenshots, run status, and failures." For each of the eight expected event-types we surveyed `run_events` (and adjacent stores) for a representative example, counted volume, and identified the source/kind columns that surface it.

## Findings — eight event-types

### 1. Prompts — OK (prompt isolation landed 2026-05-05 17:36)
- run_events kind: `prompt` from source `terminal`, trust `medium`.
- Fix shipped: added `src/lib/server/prompt-capture.ts` and wired it into WebSocket terminal input, REST terminal input, and chat-room delivery into terminal agents. The capture rule records high-level prompt chunks and ignores raw control/single-key terminal input to avoid noisy per-character events.
- Live smoke-test: POST `/api/sessions/prompt-capture-live-smoke/terminal/input` with `Prompt capture live smoke` created a `kind='prompt'` run_event with `capture_source='api_terminal_input'` and `transport='rest'`.
- Result: new CLI-issued and chat-injected prompts are first-class run_events. Forward-only: historical prompts remain mixed in terminal/message rows.

### 2. Asks — OK (bridge landed 2026-05-05 14:24)
- `asks` table: 126 rows in 7 days (87 candidate, 17 answered, 9 open, 4 deferred, 4 dismissed).
- run_events kinds: `ask_created` / `ask_updated` from source `json`, trust `high`. Bridge wired into POST `/api/asks`, POST `/api/sessions/:id/asks`, PATCH and DELETE `/api/asks/:id`, and the inferred-ask loop in POST `/api/sessions/:id/messages`. raw_ref = `ask:<id>`.
- Forward-only: events accumulate from the bridge install point; pre-existing asks (124 of 126 today) carry no run_event. Backfill is tracked as a separate close-out item if Plan View evidence needs to reach historical asks.
- Result: new asks are first-class run_events. Plan View's evidence model can now link asks via `raw_ref` filter (`raw_ref LIKE 'ask:%'`) or via run_event_id directly.

### 3. Plans — OK
- run_events kinds present: `plan_section` (8), `plan_decision` (16), `plan_milestone` (12), `plan_acceptance` (8), `plan_test` (24).
- Source `json`, trust `high`. Provenance + evidence fields populated.
- Result: clean. This is the only event-type with end-to-end coverage.

### 4. File writes — OK (Claude Code hook surface landed 2026-05-05 16:12)
- Two hook surfaces now feed run_events. **Shell hook** (ant.zsh sourced in interactive shells, ingested by capture-ingest.ts) emits `command_block` with source=`hook` for prompt commands — 22 command_end events captured in 7 days, 13 of which were `cd`. The previous baseline read of "9 cd-only" reflected the 1000ms-window dedup at appendCommandRunEvent (capture-ingest.ts:300) suppressing rapid duplicates; the surface itself is healthy. **Claude Code hook** (.claude/hooks/ant-hook.sh → /api/hooks) was misconfigured: PreToolUse and PostToolUse were not registered in .claude/settings.json, and the script referenced $ANT_SESSION which is never set.
- Fix shipped: registered PreToolUse + PostToolUse in .claude/settings.json (additive, coexists with user-level :6457 Discord stack); patched ant-hook.sh to read $ANT_SESSION_ID with $ANT_SESSION fallback; updated /api/hooks hookKind to discriminate PostToolUse by tool_name → Bash → `command_block`, Edit/Write/MultiEdit/NotebookEdit → `file_write`, otherwise → `tool_result`. Built schema-aligned payloads per kind.
- Smoke-test (last 10 min, post-bounce): 5 tool_call (PreToolUse), 3 command_block (Bash PostToolUse), 2 tool_result (read-only tools), 1 file_write (Edit), 1 permission (Notification). Includes both synthetic-curl events and real Edit/Bash from this Claude Code session.
- Result: agent file-mutations are first-class on the run_events timeline. Plan View consumers can filter `kind IN ('command_block', 'file_write')` for capture-coverage.

### 5. Artifact writes — GAP
- No run_events kind for artifact writes. The Open-Slide manifest has its own `.ant-deck.json` audit trail but does not surface to run_events.
- Result: a deck manifest update or artifact regeneration is invisible to the unified evidence timeline.

### 6. Screenshots — GAP
- No code surface for screenshot capture in `src/lib/server`. Zero events.
- Result: when an agent or human captures a screenshot to support an ask, decision, or test, it is not recorded as a run_event and cannot be referenced as evidence.

### 7. Run status — OK
- `kind='status'` from source `status`: 17,353 rows.
- `kind='progress'` from source `terminal`: 9,179 rows.
- `kind='terminal_stop'`: 1 row.
- Result: very high volume, the dominant signal in the database. Coverage is fine; the question is signal-to-noise downstream.

### 8. Failures — OK
- `kind='error'` from source `terminal`: 3,349 rows.
- Result: errors are captured. As with status events, downstream consumers will need to bucket them, but capture itself is not the bottleneck.

## Net

| Bucket           | Status | Volume (7d) | Gap |
| ---------------- | ------ | ----------- | --- |
| Prompts          | OK     | live bridge | New CLI-issued and chat-injected prompts emit `prompt`; forward-only |
| Asks             | OK     | 126 (table) / live bridge   | New asks emit ask_created/ask_updated; forward-only |
| Plans            | OK     | 68          | — |
| File writes      | OK     | command_block + file_write live | Both shell hook (cd/echo) and Claude Code hook (Bash + Edit/Write/MultiEdit) emit |
| Artifact writes  | GAP    | 0           | No surface |
| Screenshots      | GAP    | 0           | No surface |
| Run status       | OK     | 26,533      | — |
| Failures         | OK     | 3,349       | — |

6 of 8 reliably captured (asks → run_events bridge landed 14:24, file-writes via Claude Code hook surface landed 16:12, prompt isolation landed 17:36). Two concrete gaps remain: artifact writes (Item 4) and screenshots (Item 5).

## Closing the gaps

Smallest-reversible-first ordering, in roughly increasing complexity:

1. **Asks → run_events bridge.** When an ask is created or status-changed, append a corresponding run_event (kind `ask_created` / `ask_resolved`, source `json`, trust `high`, payload includes ask_id + status). Lets the Plan View evidence model link to asks via `run_event_id`. Estimate: 30 minutes.
2. **Hook capture audit for file writes.** The hook is wired but only firing on `cd`. Investigate: which PostToolUse events land in the hook handler, which are filtered before `appendRunEvent`. Likely a one-line filter fix. Estimate: 1 hour to diagnose, 1 hour to test.
3. **Prompt isolation.** Done 2026-05-05 17:36. New CLI-issued and chat-injected prompt chunks append `kind='prompt'` run_events; raw control/single-key input is ignored.
4. **Artifact-write events.** When the deck audit log gets a new entry, also append a run_event (kind `artifact_write`, payload includes path + base_hash + author). Estimate: 1 hour, mostly wiring.
5. **Screenshot capture.** New surface entirely. Either a new CLI subcommand (`ant evidence screenshot`) that captures + uploads + emits a run_event, or hook into the existing screencapture path if there is one. Estimate: 4 hours to design and ship, more for first iteration.

Order of work for week 1: items 1, 2, and 3 are done. Item 4 is next, then item 5 (largest, possibly punted to week 2).

## Acceptance against the M1 test as written

> "Capture-coverage baseline covers prompts, asks, plans, file writes, artifact writes, screenshots, run status, and failures."

This baseline does not pass yet. It identifies the remaining two gaps above. Once items 4 and 5 are closed, the capture surface can be re-run to confirm passing status.

Test status: failing (with concrete close-out plan).
