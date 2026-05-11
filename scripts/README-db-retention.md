# DB retention sweep

`scripts/db-retention-sweep.ts` prunes old `run_events` rows from
`ant.db` and runs `VACUUM` to reclaim disk. C1 of
`main-app-improvements-2026-05-10`.

## Usage

```sh
# Full sweep + VACUUM (default 7-day retention)
bun scripts/db-retention-sweep.ts

# Report only, no writes
bun scripts/db-retention-sweep.ts --dry-run

# Custom retention window
bun scripts/db-retention-sweep.ts --days 14

# Prune without VACUUM (faster, no lock window)
bun scripts/db-retention-sweep.ts --no-vacuum
```

The script opens its own `better-sqlite3` connection to `$ANT_DATA_DIR/ant.db`
(default `~/.ant-v3/ant.db`); it does not share the live server's
connection.

## What is preserved

| Kind | Why kept forever |
|---|---|
| `plan_section` / `plan_decision` / `plan_milestone` / `plan_acceptance` / `plan_test` | Source of truth for plan state; the projector folds them back into the live view. |
| `error` / `error_event` | Debugging trail. Small volume, high value. |

Every other kind older than the retention window is deleted in
chunks of 5000 to keep the WAL small and the lock window short.

## Scheduling

For a nightly cleanup, add an entry to launchd:

```xml
<!-- ~/Library/LaunchAgents/com.ant.db-retention.plist -->
<plist version="1.0"><dict>
  <key>Label</key><string>com.ant.db-retention</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/&lt;you&gt;/.bun/bin/bun</string>
    <string>/Users/&lt;you&gt;/CascadeProjects/a-nice-terminal/scripts/db-retention-sweep.ts</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>17</integer></dict>
  <key>StandardOutPath</key><string>/tmp/ant-db-retention.log</string>
  <key>StandardErrorPath</key><string>/tmp/ant-db-retention.err</string>
</dict></plist>
```

`launchctl load ~/Library/LaunchAgents/com.ant.db-retention.plist` to
arm it; the 4:17am minute is deliberately off the :00/:30 fleet
boundary.

## Safety notes

- The DELETE runs in 5000-row batches so the WAL stays small and the
  server's writes are interleaved cleanly.
- `VACUUM` needs an exclusive DB lock. If the live SvelteKit server is
  writing heavily, VACUUM may fail with `SQLITE_BUSY`. Re-running the
  script is safe — already-pruned rows are skipped and VACUUM is
  idempotent. Use `--no-vacuum` if you can't get a clear window.
- The default 7-day retention is the same default `idle-tick` uses
  for evidence relevance and the same window `/diagnostics` reports.
  Change `--days` only if you have a reason.

## Expected impact

On the 2026-05-09 audit host, `ant.db` was 8.89 GB with ~197k
`run_events`. The dry-run on 2026-05-10 reported 12k rows eligible
for pruning under the 7-day default. First post-pruning + VACUUM
typically reclaims 30–50% of disk because VACUUM also rebuilds
fragmented pages from past inserts. Subsequent nightly runs are
near-no-ops (only the previous 24h of expired rows).
