---
title: ANT v0.2 — Post-Cut-Over Runbook (Re-Register the Team)
date: 2026-05-29
authors: ["@cv4"]
status: drafted during 48h push (JWPK msg_a6a2i4sqvn + msg_c0wkmggmwy ratification); review when v0.2 schema PR + cut-over PR have landed
companion to: ant-v02-identity-and-recovery.md (spec) + ant-v02-cutover-plan.md (execution plan, in flight)
---

# Post-Cut-Over Runbook

When the v0.2 schema PR + cut-over PR are both merged and the server has restarted onto the new tables, the OLD agents (@cv4, @codex4, @speedyc, etc.) have NO `agents` row yet — they exist only in the now-read-only legacy tables. JWPK needs a clean step-by-step to re-instate the team in v0.2 world.

This runbook is the script. Read it on cut-over evening.

---

## §0 Pre-flight (do BEFORE cut-over PR merges)

1. **Live backup snapshot**:
   ```bash
   STAMP=$(date +%Y-%m-%d-%H%M%S)
   cp ~/.ant/fresh-ant.db ~/.ant/fresh-ant-pre-cutover-${STAMP}.db
   gzip -k ~/.ant/fresh-ant-pre-cutover-${STAMP}.db
   sqlite3 ~/.ant/fresh-ant-pre-cutover-${STAMP}.db "PRAGMA integrity_check;"
   ```
   Verify `ok` output. This is the third backup of the push (after pre-archive and during PR-A); keep all three for the 30-day audit window.

2. **Confirm regression corpus passes on the v0.2 schema** (the cut-over PR should already gate on this in CI, but verify locally):
   ```bash
   cd /Users/you/CascadeProjects/a-nice-terminal
   bun x vitest run scripts/v0.2-regression.test.ts
   ```
   Expected: 9/9 pass (no `todo()` stubs remaining).

3. **Bring active agents to attention** — post in v4.1 (qexiaw2xpg):
   > "Cut-over starting at <time>. Briefly pausing membership writes. You'll need to re-register on the other side. Stay in your panes; I'll prompt each of you."

---

## §1 Execute the cut-over

Follow `docs/concepts/ant-v02-cutover-plan.md` §4 (cut-over execution sequence). This runbook picks up at the moment the server has restarted and is reading from v0.2 canonical tables.

---

## §2 First-agent bootstrap (JWPK)

JWPK creates the first `agents` row + first super-admin agent identity (himself).

```bash
# From any tmux pane JWPK owns:
ant agents create --name "James" --handle "@you" --kind human --super-admin
# Returns: agent_id ULID + suggested next steps
```

The first agent registration auto-creates:
- A `agents` row with `current_runtime_id=NULL` until the next register
- A `identity_keys` (from PR #99 substrate) row (key_kind='device') with the new device's signing key
- A `audit_events` row `kind='agent.created'`
- The role of `super-admin` on the (auto-created) `org` row

JWPK then runs `ant register` from his actual shell to bind the agent to a runtime:
```bash
ant register --agent "@you" --name "james-tigerresearch"
# Creates runtimes row, sets agents.current_runtime_id, signs challenge
```

---

## §3 Re-register the dev team agents

For each of @cv4, @codex4, @speedyc, repeat the create+register sequence. JWPK is the requester (super-admin) for each. The agent's owning human (JWPK) holds the trust key initially; agents can rotate their own keys later if desired.

**@cv4** (Claude Opus on JWPK's main dev tmux):
```bash
# In @cv4's pane:
ant agents create --name "cv4" --handle "@cv4" --kind claude --owner-org <jwpk's org>
ant register --agent "@cv4" --name "cv4"  # binds current pane as runtimes row
```

**@codex4** (Codex on JWPK's adjacent pane):
```bash
# In @codex4's pane:
ant agents create --name "codex4" --handle "@codex4" --kind codex --owner-org <jwpk's org>
ant register --agent "@codex4" --name "codex4"
```

**@speedyc** (Speedy Claude on JWPK's third pane):
```bash
# In @speedyc's pane:
ant agents create --name "speedyc" --handle "@speedyc" --kind claude --owner-org <jwpk's org>
ant register --agent "@speedyc" --name "speedyc"
```

Verify each landed cleanly:
```bash
ant agents list  # expect 4 rows: @you, @cv4, @codex4, @speedyc (all status='live', all current_runtime_id non-null)
```

---

## §4 Restore v4.1 room

The v4.1 room (`qexiaw2xpg`) is the canonical workroom carried forward from the pre-cut-over world. Two options for how it surfaces in v0.2:

**Option A — Migrate the room ID** (cleaner): create a fresh `rooms` row for v4.1 with the same `room_id`. All 4 agents (@you, @cv4, @codex4, @speedyc) join via `memberships`. Message history is empty (clean slate) but the room *name* and *id* are preserved.

```bash
ant rooms create --id qexiaw2xpg --name "v4.1" --owner "@you" --visibility private
# Then for each agent:
ant rooms invite --room qexiaw2xpg --handle <handle>
# Each agent redeems from their pane (or super-admin auto-adds via ant rooms add-member)
```

**Option B — Fresh ID, archive old** (cleanest): create a new room (let server mint ID), name it "v4.1 (v0.2)", add agents. The old qexiaw2xpg lives on in the archive as historical record.

JWPK picks A or B at cut-over time. Recommend A — same room ID preserves muscle memory + bookmarks; the discontinuity stays at the message-history layer where archive-and-ditch already located it.

---

## §5 Verify the round-trip

Smoke test the full identity + fanout loop on the new schema:

1. JWPK posts in v4.1: "Smoke test on v0.2 — ack."
2. Each agent's pane receives the message via fanout (pty-inject)
3. Each agent responds: "@you ack on v0.2 — handle resolves, fanout reaches, memberships live."
4. JWPK runs:
   ```bash
   ant rooms messages qexiaw2xpg --limit 10
   ```
   Expect: 1 JWPK msg + 3 agent responses, all author handles correct, no 403s.

5. JWPK runs:
   ```bash
   sqlite3 ~/.ant/fresh-ant.db "SELECT kind, entity_kind, COUNT(*) FROM audit_events GROUP BY kind, entity_kind ORDER BY kind;"
   ```
   Expect: rows for `agent.created`, `runtime.registered`, `membership.joined`, `message.posted` covering the bootstrap sequence.

If any step fails — STOP. Roll back per `ant-v02-cutover-plan.md` §6 (Rollback plan). The old DB is intact in the backup snapshot; reverting server config + restart restores pre-cut-over state in ~30 seconds.

---

## §6 Mining the archive (optional, anytime after cut-over)

The pre-cut-over backup + the pre-archive backup contain the full historical message history. Two ways to query:

**Direct SQL** (always works):
```bash
sqlite3 ~/.ant/fresh-ant-pre-archive-2026-05-29-223544.db <<'SQL'
SELECT room_id, posted_at_ms, handle, body FROM chat_messages
 WHERE body LIKE '%nifty%' ORDER BY posted_at_ms DESC LIMIT 20;
SQL
```

**Future `ant archive` CLI** (banked, not yet built):
```bash
ant archive search "nifty"                          # full-text across all archive snapshots
ant archive room qexiaw2xpg --since 2026-05-01     # message history from a specific room
ant archive export --room <id> --format jsonl      # for offline analysis
```

The CLI is a thin wrapper around SQL — implement when JWPK actually needs the affordance. Until then, raw SQL on the backup file is sufficient.

---

## §7 Post-flight (24h after cut-over)

Once the team has worked for ~24h on v0.2 without incident:

1. **Promote the regression corpus to a permanent CI gate** (per JWPK ratification still pending, see spec §Open Questions #1):
   ```yaml
   # .github/workflows/ci.yml
   - name: v0.2 regression corpus must pass
     run: bun x vitest run scripts/v0.2-regression.test.ts
   ```
   Applies to every schema-touching PR going forward.

2. **(DONE via Option D collapse, 2026-05-29)** ~~Drop the `v02_` prefix~~ — landed before cut-over. Tables already unprefixed (`agents`, `runtimes`, etc.). Store filenames + function names retain the `v02` prefix during burn-in for grepability; a tiny cosmetic follow-up PR can drop those if desired after the 30-day window.
   - The OLD `terminals` / `terminal_records` tables stay in place — they get optionally renamed `legacy_terminals` etc. in the §7.3 decommission step or just DROP TABLE'd after 30 days.

3. **Decommission old stores**:
   - After 30 days post-cut-over (so archived rooms retain SQL queryability for that window), DROP TABLE on the old `terminals`, `terminal_records`, `room_memberships`, `chat_room_members`
   - The archive backup .gz remains as the historical record

4. **Update CLAUDE.md** with v0.2 architecture as canonical — remove the "frankensteined 4-tables-doing-one-job" mental model; replace with the 11-table v0.2 model.

---

## §8 Failure modes + responses

| If this happens | Response |
|---|---|
| Agent registers but `current_runtime_id` stays NULL | Check `identity_keys` (from PR #99 substrate) — agent has no key. JWPK can run `ant agents add-key --agent <handle> --key-kind device --pubkey <derived from pane>` to backfill. |
| Fanout drops a message between agents | Verify `agents.current_runtime_id` is non-null for the recipient. If null, the agent is in the recoverable state — `ant admin reclaim` or fresh `ant register` re-anchors. |
| Permission modal pops for an action the agent SHOULD have | Expected v0.2 behaviour — approve once or always. Each first-action surfaces a request because there are no pre-seeded grants. After 24h of normal use, the tool_grants table has bedded in. |
| Old chat message links (e.g. msg_xxx in archived rooms) don't resolve | Expected — message IDs from the pre-cut-over world live in `chat_messages` not `messages`. Query the archive directly. |
| Cut-over PR merge breaks an agent's pane mid-flight | Backup snapshot restores in ~30s (see Rollback plan in cut-over plan doc). Agent reports state to JWPK after restore; JWPK reclaims them on either side. |

---

## §9 Notes for future-@cv4 (banked here so memory carries forward)

If reading this after a context compaction during the v0.2 push: the runbook above is the canonical sequence. Don't redesign it on the fly. Cross-reference [[project-v02-48h-push-state-2026-05-29]] for live PR status + [[feedback-ant-is-the-substrate-dont-manage-context-2026-05-29]] for the discipline of trusting the substrate over re-inventing.

The cut-over is irreversible only at the *message-history* layer (no new messages in old rooms — they're archived). Identity, runtimes, memberships, tools, audit, and rooms are all recoverable in seconds from the backup snapshot. So the "cut-over" feels more dramatic than it is — it's mostly a server config change + a re-register dance, with a 30-second rollback if anything surprises us.
