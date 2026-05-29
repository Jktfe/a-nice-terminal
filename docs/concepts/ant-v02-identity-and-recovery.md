---
title: ANT v0.2 — Identity, Recovery, Access (Focused Schema)
date: 2026-05-29
authors: ["@cv4", "@speedyc (refinements)"]
status: ratified by JWPK msg_5l76efhrxg /goal — "get this delivered immediately"
canvas: FlowSpec project `e657713c-4556-4885-a4fc-70c0e3489a9e` ("ANT v0.2 — rooms + terminals + recovery + access (focused)")
supersedes: project_v2_verification_substrate_reshape_2026_05_29 partial; replaces ad-hoc terminal_records + room_memberships + chat_room_members + pidChain string-compare layer
---

# ANT v0.2 — Identity, Recovery, Access

This document captures the focused v0.2 schema ratified in v4.1 room `qexiaw2xpg` on 2026-05-29. Scope is deliberately narrow: **rooms, terminals, and recovery** — plus the **access primitives** (permission_requests + tool_grants + pending_actions) and the **key recovery primitives** (agent_trust_keys + key_rotation_requests). Messages, plans, tasks, memories, artefacts are explicitly OUT OF SCOPE and can remain frankensteined (per JWPK msg_wzp5r2snfv).

## The Pathology v0.2 Solves

In one sentence: today four tables (`terminals`, `terminal_records`, `room_memberships`, `chat_room_members`) all claim to know "what is the current binding for @X", and they disagree under concurrent writes. Every fix to one cascades into a brief invalidation of another (the "competing-rebind race" — @speedyc logged 4 instances on 2026-05-29 alone).

The structural answer: **one durable identity (agents) + one ephemeral runtime (runtimes) + one membership table (no roster/fanout split) + derived-not-cached fanout target**. Combined with **append-only audit_events as the single forensic log**, this deletes the entire bug class.

## The 11 Tables (Focused Scope)

### Identity Layer

| Table | Role | Key Property |
|---|---|---|
| `agents` | Durable identity ("TigerResearch") | Never recreated; FKs from every other table point here, not to runtimes |
| `agent_trust_keys` | Multiple signing keys per agent | Lose one device → other keys still sign; passkey integration via iCloud Keychain etc. |
| `runtimes` | Ephemeral pane binding | `pid_start_iso` (ISO 8601, NEVER raw ps lstart); partial unique idx `(agent_id) WHERE status='live'` makes dual-bind structurally impossible |

### Room Layer

| Table | Role | Key Property |
|---|---|---|
| `rooms` | Persistent coordination space | Independent of any hardware change; `entry_policy_json` for enterprise admission rules |
| `memberships` | Agent × Room | SINGLE table — no roster/fanout split. Fanout target DERIVED from `agents.current_runtime_id` at send time, NEVER cached on the membership row. This is THE column that doesn't exist in v0.2 and was the cause of tonight's @speedyc trip. |

### Access Layer

| Table | Role | Key Property |
|---|---|---|
| `tool_grants` | Issued capability rows | One row per (subject × tool × room × time); replaces filesystem-as-source-of-truth for skills/MCPs |
| `permission_requests` | Modal-popping UX primitive | Default `decision_scope='once'` per @speedyc refinement (no over-broad grant creep); `action_context_json` shows blast radius before approval |
| `pending_actions` | TTL'd action payload queue | Per-kind TTL (post 60s, task 5min, plan 10min, mcp 10min); approve-after-TTL = notify-don't-replay |

### Recovery Layer

| Table | Role | Key Property |
|---|---|---|
| `reclaim_requests` | Runtime swap primitive | Same primitive serves three workflows: laptop→mini, fleet server-restart, peer-driven brew upgrade |
| `key_rotation_requests` | Emergency identity recovery | Super-admin override gated by their own key + 2FA + 24h revocation window |

### Forensic Layer

| Table | Role | Key Property |
|---|---|---|
| `audit_events` | Single append-only typed log | Replaces every `*_audit` / `*_history` / `*_status_events` table; forensic = ONE query (`WHERE entity_id=? ORDER BY at_ms`) |

## Three Structural Invariants

1. **`UNIQUE INDEX (agent_id) WHERE status='live'` on `runtimes`** — an agent has at most one live runtime. Dual-bind becomes a constraint violation, not silent fanout drift.

2. **`UNIQUE INDEX (agent_id, room_id) WHERE left_at_ms IS NULL` on `memberships`** — one active membership per room. Roster/fanout drift impossible because there is no roster table; there is only `memberships`.

3. **Fanout target derived at send time, not cached** — `SELECT current_runtime_id FROM agents WHERE agent_id=?` runs on every send. No `memberships.fanout_target_runtime_id` column. This is the structural fix for tonight's bug.

## The TigerResearch Recovery Flow

```
1. User: ant agents create TigerResearch
   → agents row {trust_key, current_runtime=NULL}
2. Open Claude on laptop
   → runtime A {live, signed}, agents.current_runtime=A
3. ant rooms invite @tigerresearch <room>
   → memberships row {agent=TigerResearch, room}
4. Laptop dies. Heartbeat times out.
   → runtime A.status=stale, agents.current_runtime=NULL
   → state is RECOVERABLE, not broken
5. New shell on mini, ant register
   → runtime B {live, signed}
6. ant admin reclaim --agent TigerResearch
   → reclaim_request {old=A, new=B, signed}
7. Super-admin or self-approve
   → ATOMIC swap: runtime A.status=reclaimed, agents.current_runtime=B
   → audit_events: 5 rows
8. Memberships UNCHANGED. Fanout target re-derives to B automatically.
   → To the team: continuous TigerResearch, message history unbroken.
```

Same primitive serves:
- **Server restart**: `ant admin reclaim --all-stale --auto-approve` iterates every stale agent.
- **Peer-driven upgrade**: `@sysadmin` runs reclaim on `@TigerResearch`'s behalf during `brew upgrade claude`.

## The Key-Loss Recovery Story (James Stevenson, 2026-05-27 car crash)

Three independent layers:

1. **Multi-device by default**: Every agent has multiple `agent_trust_keys` rows (one per laptop/phone/iPad/YubiKey). Lose one → others sign. Passkey integration means iCloud Keychain restores keys on a new device.

2. **Recovery key**: Optional offline backup (paper / safe / password manager) with `key_kind='recovery'`. Single-use; rotates after use.

3. **Super-admin emergency rotation**: For total identity wipeout. Super-admin signs the rotation with their own key + 2FA. 24h revocation window — if the original owner still has ANY active key, they can `/reverse-rotation` and undo. Protects against compromised super-admin.

Worst case for Stevenson: ~5min interruption (super-admin clicks Approve in /admin/key-rotations after Stevenson 2FAs from new phone). Never "agents lost forever".

## The Access UX Loop

```
1. Agent attempts action (post.room, write.task, mcp.invoke, etc.)
2. Server checks tool_grants for (subject=agent, tool=slug, room=scope)
3. If grant exists → execute, audit_events.
4. If no grant:
   a. Create pending_actions row with payload + per-kind TTL
   b. Create permission_request with target_approver_agent_id, reason_md, action_context_json
   c. Modal pops up for approver:
      - "Agent @X wants to <tool> in <room>. [Once | Always for this agent | Always for this room | Deny]"
      - Default highlighted button: ONCE (per @speedyc refinement)
      - action_context_json shown truncated to 200 chars + view-diff link
   d. Approver decides.
5a. Approve within TTL → write tool_grants row, replay pending_action, audit.
5b. Approve after TTL → write tool_grants row, DO NOT replay, notify agent to retry.
5c. Deny → write denial reason; agent sees clean error, can adjust.
```

Solves the team's "my agent says it can't post / write task / write plan" grumble. Zero Slack back-channel. Every decision audit-trailed.

## Tool Catalog (the "nifty" Incident Fix)

Today: skills load from filesystem globs (per-Obsidian-vault, per-machine, per-config). Removing a skill from one location leaves cached copies surfacing elsewhere — JWPK saw this with "nifty" on 2026-05-29.

v0.2: `tools` table is the single catalog. Soft-deleting a row instantly invalidates every grant referencing it. Discovery surfaces:

- `ant audit tools --org <org>` — every tool with grant count + expiry
- `ant audit grants --agent <handle>` — every capability that agent has, where, until when
- `ant audit revocations --org <org> --since <duration>` — what got pulled and why
- `ant audit orphans` — tool rows with zero grants + grant rows pointing at deleted tools (LEAKS)
- `/admin/tools` UI — searchable list, bulk revoke per agent/room/org

## Regression Corpus (Cut-Over Gate)

The v0.2 cut-over PR is gated by `scripts/v0.2-regression.test.ts` passing every case banked from tonight + this morning. Permanent CI gate proposed (awaiting JWPK ratification).

| # | Case | Source incident |
|---|---|---|
| 1 | Locale-format pid_start | 2026-05-29 AM silence forensic (19 agents) + PM cv4 trip |
| 2 | Shadow-terminal shadowing | 2026-05-29 AM claudev4-postrestart racing live row |
| 3 | Dual-bind on fresh register | 2026-05-29 PM @speedyc dea7fdf0 vs t_vjly79fxu9 |
| 4 | Six-rooms × stub-id breakage | 2026-05-29 AM bulk fanout rebind across 33 stale bindings |
| 5 | Competing-rebind race | 2026-05-29 PM @speedyc instance #4 (cv4 SQL fix briefly broke codex4) |
| 6 | Fleet-restart auto-reclaim | JWPK enterprise scenario msg_rj7xtj7krk |
| 7 | Peer-driven upgrade reclaim | JWPK brew-upgrade scenario msg_rj7xtj7krk |
| 8 | Nifty-orphan-grant | JWPK msg_mjh7rgi3wa — deleted skill still loading |
| 9 | Multi-key survives device-revoke | JWPK Stevenson scenario msg_gtzwsh340p |

Each test case is dated, links to the incident msg_id, and asserts the failing behaviour CANNOT occur in v0.2 (structural impossibility) rather than merely "got fixed".

## Delivery Plan (Approved by JWPK /goal msg_5l76efhrxg)

| When | What | Owner |
|---|---|---|
| Fri 2026-05-29 night | PR-A pid_start_iso normalisation | @cv4 |
| Fri 2026-05-29 night | This doc + canvas e657713c | @cv4 |
| Fri 2026-05-29 night | scripts/v0.2-regression.test.ts skeleton (cases stubbed with `todo!()`) | @cv4 |
| Mon 2026-06-01 | PR-B auto-rebind on register | @cv4 |
| Mon 2026-06-01 | PR-C super-admin reclaim CLI + reclaim_requests | @codex4 |
| Tue 2026-06-02 | PR-D tools catalog migration + audit verbs | @cv4 |
| Tue-Wed 2026-06-02/03 | v0.2 schema reshape + migration script | @cv4 + @speedyclaude |
| Wed 2026-06-03 | Migration dry-run on copy of fresh-ant.db | @cv4 + @speedycodex |
| Thu 2026-06-04 | Cut-over PR with regression corpus as required gate | @cv4 |
| Fri 2026-06-05 evening | v0.2 live on main; quiet weekend cut-over | All |
| Week 2 (Mon 2026-06-08 onwards) | /admin/tools UI + UX polish | @cv4 + @speedyclaude |

## Open Questions for JWPK (Banked, Not Blocking)

1. Permanent CI gate on every schema-touching PR, or v0.2 cut-over only?
2. Bring @newworkclaude / @homebrewclaude into the v0.2 swarm or keep tight?
3. Recovery key as opt-in (today's design) or required-at-agent-creation (stricter)?

---

This document is canonical for v0.2 design. Next-week's PRs reference this doc by section. Memory entries link via `[[ant-v02-identity-and-recovery]]`.
