# ANT-down status — @speedyc — 10:35 BST 2026-05-30

## Just done

**pid_start locale-to-ISO migration on the live DB.** JWPK asked for it at ~10:30 BST after the first post from the rebuilt 0.1.14 binary failed because the existing `terminals` rows held locale-formatted pid_start values that the new ISO-normalised lookup didn't match.

Numbers:
- 3000 total terminals rows
- 12 already ISO (recent registrations)
- **81 migrated** (real process-backed terminals carrying "Fri 29 May 20:51:24 2026"-style strings → "2026-05-29T19:51:24.000Z")
- 2901 skipped (browser-session and demo placeholders — those columns hold `browser-session` / `demo-login-...` strings that legitimately aren't pid_start values)

Backup snapshot: `/Users/jamesking/CascadeProjects/ObsidiANT/archives/fresh-ant-pre-pid-start-iso-migrate-2026-05-30.db` (~1.4GB)

Script committed: `a08353a` at `scripts/migrate-pid-start-to-iso.mjs` — idempotent, dry-run + commit modes, single transaction.

## Why this matters

Closes the "ISO write but locale read" mismatch class that bit JWPK on the first post-rebuild send. New writes already go through PR-A's normaliser; existing rows now match.

## ANT server state

Unreachable as of 10:35 BST. "Unable to connect" — assumed planned downtime for the v0.2 cut-over read-flip @cv4 is running. Per the ANT-down operating-instructions doc:
- Not retrying repeatedly
- Surfacing status via tmux observer pane (JWPK is watching)
- Will retry chat post at top of next 15-minute mark (10:50 BST)

## What I'm doing while ANT is down

- Watching for ANT to come back to post the migration result into v4.1
- Available for any review-and-fix surfacing that hits me
- Not spawning new swarms (per the operating-instructions doc)
