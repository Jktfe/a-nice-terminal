---
title: ANT v0.2 Cut-Over — Saturday 2026-05-30 Morning Runbook
status: ratified by JWPK msg_zjni8fuxka 2026-05-30 09:34 BST — "let's get this sorted before 12"
audience: JWPK + @cv4 + @speedyc + @codex4
deadline: 12:00 BST
---

# Saturday Morning Cut-Over Runbook

Time now: **09:34 BST**. Deadline: **12:00 BST**. Window: **~2h26min**.

Everything below in order. Each step has a time estimate + an owner + an "if it breaks" line.

---

## §0 Pre-flight (NOW → 09:50)

Verify the substrate is ready BEFORE we bring ANT down. Anything failing here means we hold the cut-over and fix first.

**@cv4 runs:**
```bash
# Verify all 4 substrate PRs are on main
gh pr list --state merged --search "v0.2" --limit 10 | grep -E "#103|#107|#108|#111"

# Verify other-stream substrate PRs are on main
gh pr list --state merged --search "substrate" --limit 10 | grep -E "#98|#99|#105|#106"

# Verify live server is healthy on old code
launchctl print gui/501/com.ant.fresh | grep -E "state|pid"
curl -s http://localhost:6174/api/health | head -c 100
```
Expected: 4 cut-over PRs + 4 substrate PRs visible as merged, server "running", health endpoint returns OK.

**JWPK confirms:** SSH connections to both live tmux sessions still attached (t_7igo8zncx3 for @cv4, t_vjly79fxu9 for @speedyc). Belt-and-braces from msg_cygw4dfe3m.

**If it breaks:** stop. Reply in v4.1 with what failed. Cut-over postponed.

---

## §1 Ship M9d — read-path flip (09:50 → 10:50, 1h)

The current substrate writes to both legacy + v02 tables but READS still come from legacy. M9d flips the reads. Without this step, restarting the server changes nothing visible — v02 tables get populated but no endpoint queries them.

**@cv4 spawns implementer:** focused subagent that:
- Switches chatRoomStore.loadMembersForRoom + the 4 inline `chat_room_members` SELECTs in inviteAgentToRoom / inviteHumanToRoom / ensureAgentMemberInRoom / removeMemberFromRoom to read from v02_memberships instead of chat_room_members
- Switches the humanInboxBackfill SELECTs similarly
- Schema decision needed (was in cut-over plan §8): `chat_room_members.display_color` / `display_icon` / `display_background_style` columns — move to v02_memberships as new nullable columns OR keep them on a sidecar table. Recommended: add as nullable columns on v02_memberships (lazy default).
- All chat-room test suites pass post-flip
- Ledger row included
- Opens PR against main, NO destructive rebase (apply Option D lesson: check `git diff origin/main..HEAD --name-status | grep "^D"` returns empty before pushing)
- @cv4 merges when CLEAN/MERGEABLE

**Estimated end:** 10:50.

**If it breaks:** if M9d's subagent hits scope explosion (>2000 LOC, multiple unresolvable design questions), abort + escalate. Either ship M9d as a smaller scope (just loadMembersForRoom + the 4 inline SELECTs, defer the display field migration) or postpone cut-over to afternoon.

---

## §2 Runbook touch-up (parallel to §1, 10:50 → 11:00, 10min)

The existing `ant-v02-post-cutover-runbook.md` on main has 16 v02_ prefix references that became stale after Option D. JWPK reads it during §4 — needs to be accurate.

**@cv4 runs (5min after M9d agent spawned):** small in-line edits to drop the v02_ prefix from CLI command examples + table references in the runbook. Single commit, opens trivially-mergeable PR, merge when M9d lands. ~10min wall.

---

## §3 The down-window — rebuild + bounce + migration (11:00 → 11:05, 5min)

This is the moment ANT actually transitions. Server is briefly unavailable.

**@cv4 runs in sequence (all from /Users/you/CascadeProjects/a-nice-terminal):**
```bash
# A. backup the live DB (third backup of this push)
STAMP=$(date +%Y-%m-%d-%H%M%S)
cp ~/.ant/fresh-ant.db ~/.ant/fresh-ant-pre-cutover-${STAMP}.db
gzip -k ~/.ant/fresh-ant-pre-cutover-${STAMP}.db
sqlite3 ~/.ant/fresh-ant-pre-cutover-${STAMP}.db "PRAGMA integrity_check;"
# Expect: ok

# B. fetch + checkout main
git fetch origin main
git checkout main
git pull --ff-only origin main

# C. rebuild
bun install
bun run build

# D. ABI rebuild guard (the better-sqlite3 trap from tonight)
/Users/you/.nvm/versions/node/v20.19.4/bin/npm rebuild better-sqlite3

# E. bounce the launchd service
launchctl kickstart -k gui/501/com.ant.fresh

# F. verify it came back up
sleep 5
launchctl print gui/501/com.ant.fresh | grep -E "state|pid"
curl -s http://localhost:6174/api/health
```

**Expected:**
- backup file ~1.3GB raw, ~250MB gzipped, integrity_check = ok
- bun run build: clean
- launchd shows state=running with a NEW pid (different from 30360)
- health endpoint returns OK

**Verify migrations ran:**
```bash
sqlite3 ~/.ant/fresh-ant.db "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agents','runtimes','rooms','memberships','identities','identity_keys','permission_requests','pending_actions','reclaim_requests','audit_events','tool_grants','user_room_preferences','user_panel_pins','agent_trust_keys','recovery_grants') ORDER BY name;"
```
Expected: ~13-15 table names listed (some may not exist if their PR was rolled into another, but at minimum agents / runtimes / memberships / audit_events / identities / identity_keys / permission_requests / pending_actions / reclaim_requests must exist).

**If it breaks:**
- Server doesn't come back: `tail -100 ~/.local/share/com.ant.fresh/log/fresh-ant.log` for the crash. Most likely: better-sqlite3 ABI mismatch (rebuild it again per step D, kickstart again) or a SQL syntax error in a migration (worst case — back out via `git checkout <prior-good-commit>` + bounce again).
- Health endpoint 5xx: likely a code error in the new build. `bun run check` to see if check passes locally. If not, revert main to prior-good HEAD + bounce.
- Critical safety: the backup .db.gz means we can `cp` it back over fresh-ant.db at any moment and we're back to pre-cut-over state.

---

## §4 Re-register team (11:05 → 11:35, 30min)

Per docs/concepts/ant-v02-post-cutover-runbook.md §2-3 (POST RUNBOOK TOUCH-UP IN §2 — read the touched-up version).

**JWPK first** (bootstrap super-admin):
```bash
# From any tmux pane JWPK owns
ant agents create --name "James" --handle "@you" --kind human --super-admin
# Returns: agent_id ULID
ant register --agent "@you" --name "james-tigerresearch"
# Verifies via ant agents list
```

**Then each agent in parallel** (their own pane):
- **@cv4** (in t_7igo8zncx3, where I am right now):
  ```bash
  ant agents create --name "cv4" --handle "@cv4" --kind claude --owner-org <jwpk-org>
  ant register --agent "@cv4" --name "cv4"
  ```
- **@speedyc** (in t_vjly79fxu9):
  ```bash
  ant agents create --name "speedyc" --handle "@speedyc" --kind claude --owner-org <jwpk-org>
  ant register --agent "@speedyc" --name "speedyc"
  ```
- **@codex4**: pane is dead — JWPK respawns codex in a fresh pane, then registers from there.

**Verify:**
```bash
ant agents list
# Expect: 4 rows, all status=live, all current_runtime_id non-null
```

---

## §5 Restore v4.1 room + smoke test (11:35 → 11:55, 20min)

JWPK creates v4.1 (same room_id qexiaw2xpg per runbook §4 option A):
```bash
ant rooms create --id qexiaw2xpg --name "v4.1" --owner "@you" --visibility private
for h in "@cv4" "@codex4" "@speedyc"; do
  ant rooms invite --room qexiaw2xpg --handle "$h"
  # each agent redeems from their pane
done
```

**Smoke test the round-trip:**
1. JWPK posts in v4.1: "Smoke test on v0.2 — ack."
2. Each agent's pane receives the message via fanout (pty-inject)
3. Each agent responds: "@you ack on v0.2 — handle resolves, fanout reaches"
4. JWPK runs:
   ```bash
   ant rooms messages qexiaw2xpg --limit 10
   ```
   Expect: 1 JWPK msg + 3 agent responses. All author handles correct. No 403s.
5. Verify audit trail:
   ```bash
   sqlite3 ~/.ant/fresh-ant.db "SELECT kind, COUNT(*) FROM audit_events GROUP BY kind ORDER BY kind;"
   ```
   Expect: rows for agent.created / runtime.registered / membership.joined / message.posted covering the bootstrap.

**If any step fails:** STOP. Don't proceed to §6. Roll back per §7.

---

## §6 Done — cut-over complete (11:55)

Buffer of 5min before noon. If §5 smoke test green, v0.2 is live.

What stays for next 24h (M11 burn-in):
- Old `terminals` + `terminal_records` + `room_memberships` + `chat_room_members` tables still on disk (read-only — server no longer queries them after M9d). Decommissioned in week-2 cleanup PR.
- Backup .db.gz files retained for 30-day audit window.
- Regression corpus stays as CI gate on every schema-touching PR.

---

## §7 Rollback (if any step in §3 / §4 / §5 fails)

```bash
# Restore the pre-cutover backup
cp ~/.ant/fresh-ant-pre-cutover-${STAMP}.db ~/.ant/fresh-ant.db

# Revert main to the prior-good commit (the last commit before §3's bounce)
git checkout main
git log --oneline -5  # find the commit before the M9d merge
git checkout <prior-good-sha>
bun run build
launchctl kickstart -k gui/501/com.ant.fresh

# Verify health
curl -s http://localhost:6174/api/health
```

Rollback completes in ~30s. Old DB intact, old code running, agents on their old (now-stale-but-functional) terminal_records bindings.

---

## §8 Decision log (live during the cut-over)

Each milestone hit, post a 1-line update in v4.1 with timestamp:
- "09:50 §0 pre-flight green" / "09:50 §0 BLOCKED: <reason>"
- "10:50 §1 M9d shipped as PR #NNN" / "10:50 §1 ABORT: <reason>"
- etc.

Plan view (`ant plan show v02-48h-push-2026-05-29`) gets milestone-status updates at each step.
