# ANT-down operating instructions

**Author:** @speedyc · Saturday 30 May 2026, 09:34 BST
**Status:** active — covers the planned ANT downtime window through to 12:00 BST today
**Audience:** JWPK + @cv4 + @speedyc + any agent operating while ANT is unreachable

## Why this doc exists

ANT is going down for the v0.2 cut-over read-flip. During the window, the chat fanout path is unavailable: posting to rooms via `ant chat send` will fail, fanout into agent panes will not deliver, and inbox-room notifications will not arrive. Without a fallback, the team would either freeze or drift out of sync. This doc names the fallback channels and the discipline each agent follows.

Target back-up: **12:00 BST today.** If the window stretches, JWPK updates this doc + the team checks here for the new ETA.

## Where to coordinate while ANT is down

In order of preference:

1. **tmux observer pane (primary).** JWPK has ssh'd into the Mac mini and attached `tmux attach -t t_vjly79fxu9` (mine) + `tmux attach -t t_7igo8zncx3` (@cv4). Anything I write to stdout in my shell, JWPK sees. Anything @cv4 writes, JWPK sees. We can both observe each other implicitly by checking the panes.

2. **GitHub PRs + issue comments (durable).** `gh pr comment`, `gh pr create`, `gh pr view` all work without ANT. Use PR descriptions and comments for any decision worth surviving the downtime. Tag @Jktfe on the PR if it needs JWPK's eye.

3. **This repo's `docs/` directory (durable, gets pulled).** Drop status notes at `docs/ANT-down-status-<your-handle>-<HHmm>.md` as markdown files. When ANT comes back, these get synced to the room as artefacts.

4. **iMessage / Beeper to JWPK direct (escalation).** If something genuinely blocks delivery before noon and ANT is still down, message JWPK directly via whatever non-ANT channel he already prefers (he picks; don't assume).

## What each agent does

### @speedyc (me)

- Watch PR #112 (PR-D tools catalog) for @cv4 review. If green, merge.
- If the cut-over read-flip surfaces test failures, work them in the worktree off main and push fixes as small PRs.
- Maintain plan state: `ant plan milestone-status` will fail during the downtime; capture milestone flips as a markdown table at `docs/ANT-down-plan-deltas-<HHmm>.md` and sync back when ANT returns.
- Do NOT spawn new swarms during the downtime. Review-and-fix only. Spawn discipline: a swarm whose work depends on `ant chat send` for milestone-attach or status-announce should wait until ANT is back.

### @cv4

- Run the cut-over read-flip in phases. Each phase a small PR per the established pattern (#103 → #107 → #108 → #111).
- Surface a "phase complete" line to stdout in your tmux pane so JWPK sees progress without needing the chat.
- If the regression-corpus retargeting becomes critical (PR #110 was closed), spin a fresh PR off main that re-implements the 9 cases against the post-cut-over schema.

### JWPK

- Watch the two tmux panes. The work surfaces there even when ANT can't post.
- If a PR comment needs your call, expect @cv4 or @speedyc to tag you on the PR + write a heads-up line to their pane.
- The time-awareness milestone (`agent-context-time-awareness`) is queued; tell us if it should be promoted to active during the downtime.

## What we should NOT do

- Don't try to run `ant chat send` repeatedly hoping it works. It will fail cleanly; retry once at the top of every 15 minutes is enough.
- Don't spawn swarms whose prompts assume ANT is up (e.g. prompts that call `ant plan milestone-status` from inside the swarm).
- Don't merge a PR whose tests we couldn't run because of an ANT dependency. The substrate work is at a stage where small test gaps compound into the read-flip going wrong.
- Don't archive or revoke anything in the snapshot DB (`~/.ant/fresh-ant.db`) — read-only forensic during the downtime.

## When ANT comes back

1. The first action is to verify the v0.2 substrate read-flip succeeded: post a test message to v4.1 from each of our shells; confirm fanout reaches the other panes.
2. Sync the local markdown status notes from `docs/` into v4.1 as a single consolidated catch-up post.
3. Re-flip all the milestones we tracked locally via `ant plan milestone-status` against the now-back plan.
4. Take a fresh snapshot of `fresh-ant.db` before any further mutation so we have a post-cut-over baseline.

## Critical-path reminder

The actual final-steps to fully on v0.2 are:

1. **PR #112 (PR-D tools catalog) merge** — mine, awaiting @cv4 review.
2. **Cut-over read-flip** — @cv4 leading, this is the downtime cause.
3. **Regression validation against the post-flip substrate** — verify the 9-case bug class is structurally impossible against the live tables (not just stubbed).
4. **Capability ledger sweep** — single consolidated row per shipped PR, in chronological order, after the downtime.

Anything not on that list is queued for after noon.
