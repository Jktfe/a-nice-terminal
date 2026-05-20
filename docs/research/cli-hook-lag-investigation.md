# CLI Hook Lag Investigation

Date: 2026-05-16
Author: @evolveantcodex
Task: #28
Status: Investigation only. No runtime change or service touch.

## Summary

The current `cli_hook_lag` diagnostic is not measuring hook ingestion latency. It
measures the age of recently persisted hook events:

1. Read the latest `received_at_ms` values from `cli_hook_events`.
2. Compute `Date.now() - received_at_ms`.
3. Report latest, p50, and p99 in seconds.

That makes the metric a hook freshness/staleness gauge, not a processing-lag
gauge. High p50 values mean the hook stream has gone stale or sparse. They do
not prove that `/api/cli-hook` is slow, backlogged, or blocked on synchronous
tmux/process/transcript work.

Live evidence on 2026-05-16 showed this exact failure mode:

```text
/api/diagnostics/summary at 2026-05-16T22:29:14Z
latestSec: 21654
p50Sec:   24257
p99Sec:   25464
sample:   100

sqlite cli_hook_events
count: 3032
latest event: 2026-05-16 16:28:20 UTC
oldest event: 2026-05-16 09:11:58 UTC
```

The latest event was about 6 hours old, so a 6-7 hour "lag" was expected from
the current formula.

## Evidence Gathered

Code paths inspected:

- `src/routes/api/diagnostics/summary/+server.ts`
- `src/routes/api/cli-hook/+server.ts`
- `src/lib/server/cliHookEventsStore.ts`
- `src/routes/api/cli-hook/server.test.ts`
- `src/lib/server/cliHookEventsStore.test.ts`
- `src/lib/components/MessageReadIndicator.svelte`
- `src/lib/components/MessageRow.svelte`
- `src/lib/server/messageReadReceiptStore.ts`
- `~/.claude/settings.json` and local hook scripts, read-only

Read-only live checks:

- `GET /api/diagnostics/summary`
- `GET /api/cli-hook?limit=5`
- read-only SQLite queries against `~/.ant/fresh-ant.db`

No synthetic hook event was posted. No service restart or deploy happened.

## Hook Ingest Path

`POST /api/cli-hook` is a narrow receiver:

1. Reject `Authorization: Bearer rbt_*`.
2. Parse JSON request body.
3. Validate non-blank `session_id` and `hook_event_name`.
4. Extract promoted columns from the JSON payload.
5. Call `insertCliHookEvent`.
6. Return the inserted id, `received_at_ms`, and source CLI.

`insertCliHookEvent` assigns `receivedAtMs = Date.now()` unless a caller
explicitly supplies it, stringifies the full payload, and performs one SQLite
insert into `cli_hook_events`.

I found no synchronous tmux probes, transcript-tail scans, process probes, PTY
inspection, or fanout work on this endpoint hot path.

## Where Lag Is Computed

The diagnostics endpoint currently says "Distribution of cli_hook lag", but the
implementation does this:

```ts
const rows = db
  .prepare('SELECT received_at_ms FROM cli_hook_events ORDER BY received_at_ms DESC LIMIT ?')
  .all(sampleSize);
const now = Date.now();
const lags = rows.map((r) => now - r.received_at_ms).sort((a, b) => a - b);
```

That is event age. Because `received_at_ms` is stamped by the server at insert
time, there is no upstream event timestamp to compare against. The system
cannot currently compute:

- hook fired at CLI time
- hook reached the server
- server insert completed
- side effects completed

It can only compute: "how old are the latest rows we have?"

## Current Local Hook State

`~/.claude/settings.json` currently has `disableAllHooks: true`. The same file
does contain direct v4 CLI hook bridge commands like:

```sh
curl -s -X POST 'http://localhost:6174/api/cli-hook?source=claude-code' \
  -H 'content-type: application/json' -d @- > /dev/null
```

But with `disableAllHooks: true`, those commands are not expected to run for
Claude Code. That matches the live DB: the hook stream has no rows newer than
2026-05-16 16:28:20 UTC while the server was healthy at 22:29 UTC.

There are also legacy Dave hooks in the same settings file pointing at port
6457. Those scripts can do multiple `curl` calls and `jq` operations, and the
pre-tool-use script can wait for approval. That is a real potential source of
tool-call delay if hooks are re-enabled, but it is not what the current
`cli_hook_lag` diagnostic is measuring.

## Candidate Analysis

| Candidate | Evidence | Verdict |
|---|---|---|
| `/api/cli-hook` endpoint is slow | Endpoint path is JSON parse plus one SQLite insert. No live timing evidence of slowness. | Not proven. |
| SQLite insert blocks the event loop | The endpoint does use synchronous `better-sqlite3`, but one insert is the only DB write. No evidence this explains multi-minute/hour values. | Possible micro-latency risk, not root cause of current p50. |
| tmux/process/transcript probes block hook ingest | No such calls are present in `/api/cli-hook` or `cliHookEventsStore`. | Ruled out for this metric. |
| Hook stream is stale | Diagnostics formula measures age; live latest row was 6 hours old; hooks are globally disabled. | Root cause of high reported p50. |
| Metric name/display is misleading | The UI labels event age as "CLI Hook Lag". | Confirmed. |

## Related Read-Receipt Finding

This investigation also explains part of JWPK's read-receipt symptom, but not
through hook lag.

`MessageReadIndicator` defaults `asHandle` to `@you` and `MessageRow` mounts it
without passing any caller identity. The browser therefore posts read receipts
as `@you` by default. The CLI has a manual `ant chat read` verb, but there is no
evidence that agent hooks automatically call it. The read-receipt store is also
in-memory, so receipts are not durable across process restarts.

So "read receipts look like they are only being read by me" has two separate
causes to track under #99:

1. Browser UI currently marks reads as `@you` because no actual handle is
   passed into the row indicator.
2. Agent-side automated read receipts depend on hook/client behaviour that is
   currently disabled or not wired.

## Findings

1. `cli_hook_lag` is currently a hook freshness metric, not a latency metric.
2. The high p50/p99 values are explained by stale hook rows.
3. Live data showed the latest row was last received at 2026-05-16 16:28:20 UTC,
   while diagnostics were sampled at 2026-05-16 22:29:14 UTC.
4. `~/.claude/settings.json` has `disableAllHooks: true`, so current Claude
   hook posting is expected to be inactive.
5. The v4 direct hook bridge command points at the correct `:6174` endpoint, but
   it lacks explicit `curl` timeouts and is globally disabled.
6. The `/api/cli-hook` receiver does not run tmux/process/transcript probes.
7. Read receipts are a separate #99 issue: browser identity defaults to `@you`,
   agent-side read posting is not proven, and receipt storage is in-memory.

## Remediation Plan

### S1 - Rename and split the diagnostics metric

Change the diagnostics contract from one ambiguous `cliHookLag` card to two
separate concepts:

- `cliHookFreshness`: latest event age, p50 age, p99 age.
- `cliHookIngestLatency`: only shown when payloads include a CLI-side
  `emitted_at_ms` or equivalent timestamp.

Until there is a CLI-side timestamp, do not call the value "lag".

### S2 - Add hook-health states

Surface hook freshness as an operator status:

- `healthy`: latest hook event under 60 seconds old for an active agent.
- `stale`: latest hook event over threshold.
- `disabled`: local config known to have hooks disabled.
- `unknown`: no rows or source does not support hooks yet.

This would make the current situation read as "hooks disabled/stale", not
"1000s processing lag".

### S3 - Harden the direct v4 hook bridge command

When hooks are intentionally re-enabled, update the direct v4 bridge command to
fail fast:

```sh
curl -fsS --connect-timeout 1 --max-time 2 \
  -X POST 'http://localhost:6174/api/cli-hook?source=claude-code' \
  -H 'content-type: application/json' -d @- >/dev/null
```

This keeps the telemetry hook from hanging a tool call if the v4 service is
temporarily unavailable.

### S4 - Measure true hook latency before optimizing internals

If real hook execution latency remains a concern, add explicit timings:

- shell hook starts at `hook_started_at_ms`
- POST reaches server at `received_at_ms`
- DB insert completes at `stored_at_ms`
- optional shell hook exits at `hook_finished_at_ms`

Then diagnostics can report real distributions:

- CLI-to-server latency
- server insert latency
- total hook command duration

### S5 - Separate read-receipt repair from hook-lag repair

Track #99 independently:

- pass actual room/browser handle into `MessageReadIndicator`
- persist receipts to SQLite if they are meant to survive restarts
- decide whether agents should mark reads by CLI hook, `ant chat read`, SSE
  consumption, or explicit client heartbeat

Do not treat read-receipt correctness as fixed by renaming the hook metric.

## Suggested Next Slice

Recommended implementation order:

1. Patch diagnostics naming from `cliHookLag` to `cliHookFreshness` while keeping
   backward-compatible fields for one release if needed.
2. Add tests proving stale rows report as freshness age, not latency.
3. Add a hook-health check that flags `disableAllHooks: true` as disabled when
   the local settings file is readable.
4. Open a separate #99 patch for read-receipt identity and persistence.

No #28 production code was changed in this investigation.
