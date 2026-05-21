# B-HARDEN-sessionid-pk — terminal→CLI-sessionId link (decision-doc)

Status: DECISION-DOC (design slice, NOT impl). codex2 RQO32 gate before impl.
Owner: researchant (lane-E, coordinator-bucket robustness, zero-JWPK-dep).
2026-05-15. Lifts banked `project_sessionid_primary_key_2026_05_15` +
`feedback_disprove_finalized_root_cause_with_disk_facts`. Grounded against
current code + real `~/.ant/state` files.

---

## 1. Scope & explicit non-goals

**Goal:** a robust terminal→CLI-sessionId binding for the cases where the
current cwd-join is genuinely ambiguous/stale: git-worktree terminals,
internal `cd`, detached panes, or >1 CLI session sharing one cwd.

**Non-goals (binding):**
- NOT a FINDING-2 refix. FINDING-2's root was a scan-path bug
  (`codexTranscriptTailWatcher` scanned only stale `~/.codex/archived_sessions/`,
  not the live date tree) — fixed + triple-proven; `pane_current_path` was
  correct all along. This doc must never be cited as a FINDING-2 dependency.
- NOT a P0 / parity blocker. The normal-case cwd-join keeps working; this is
  edge-case robustness only.
- NOT a change to the normal path. cwd + newest-mtime stays the v1 baseline
  and the fallback.

## 2. Current state (grounded on disk, 2026-05-15)

- Watchers (codex/pi/etc) link terminal→session via: tmux pane →
  `pane_current_path` → cwd → newest matching transcript/rollout with
  `mtime > terminal.created_at_ms`. Works for the normal case; fragile for
  the edge cases above.
- `terminal_records.session_id` is the **ANT** terminal id (e.g.
  `t_8m1r8j2xdf`), NOT the CLI's own sessionId (codex `019e2b09…`, pi
  `019e2b73…`). No column links the two.
- The pid-bound `terminals` table + `lookupTerminalByPidChain` already
  resolve a terminal from a pid-chain (ppid walk).
- **Banked-spec correction (verify-against-disk):** the banked memory said
  `~/.ant/state/<cli>/<sid>.json` carries `pid` + `bridgeSessionId`. Real
  files today do NOT: codex-cli keys = `agent,state,session_start,cwd,
  project_dir,hook_event_name,last_user_ts,turn_id,last_resp_ts,menu_kind,
  current_tool,last_edit_ts`; gemini similar; pi = `state,session_start,cwd,
  last_user_ts,last_resp_ts`. **No `pid` field exists on disk.** So
  "pid via ~/.ant/state pid field" is NOT a free lookup — it is an
  emitter-extension prerequisite.

## 3. Candidate link mechanisms (re-grounded)

- **(a) pid-in-state-file.** Extend the per-CLI canonical-state emitters
  (the FINGERPRINT-MANIFEST emitter family — pi emitter already shipped) to
  also write `pid: process.pid` into the canonical JSON. ANT then links:
  terminal → pane → pid-chain (existing `lookupTerminalByPidChain`/ppid
  walk) → match a state file whose `pid` is in that process subtree → its
  `<sessionId>` (the filename) is the CLI sessionId. Reuses existing
  pid-chain infra + the emitter family already in flight. Cost: +1 field
  per emitter (pi: one line; claude/codex/gemini hooks each add it).
- **(b) capture-at-spawn handshake.** ANT captures the CLI sessionId when it
  spawns the CLI. Problem: the CLI generates its sessionId internally at
  start (codex rollout id, pi session id) — unknown to ANT at spawn. Needs a
  reverse handshake (env var the CLI echoes, or first-write callback). More
  moving parts, new protocol surface, only works for ANT-spawned terminals.
- **(c) newest-mtime cwd-join.** The current de-facto. Robust normal-case;
  the failure mode IS exactly the edge cases this hardening targets, so it
  cannot be the primary mechanism — but it is the correct fallback.

## 4. Recommendation (coworker — invite pushback)

**D-LINK = (a) pid-in-state-file, with (c) as explicit fallback.**
- Lowest new surface: no spawn protocol, no env handshake; reuses
  `lookupTerminalByPidChain` (already gated infra) + the emitter family
  already being built for FINGERPRINT-MANIFEST.
- Deterministic for the edge cases: pid-subtree match is cwd-independent, so
  worktree / internal-`cd` / shared-cwd all resolve correctly.
- Graceful: if no state file carries a matching pid (older CLI, emitter not
  yet installed), fall back to the existing cwd + newest-mtime join — zero
  regression to the normal path.
- Honest dependency: requires `pid` added to the canonical schema + each
  emitter. pi emitter = trivial (`pid: process.pid`); the FINGERPRINT
  per-CLI emitter rollout owns the rest. agentStateReader gains an optional
  `pid?: number` (additive, back-compatible — same pattern as the S1.2
  optional-field precedent).

## 5. Open decisions for codex2 RQO32 review

- **D-LINK** — ratify (a)+(c) fallback, or redirect to (b)/(c)-only.
- **D-SCHEMA** — add optional `pid?: number` to the canonical state schema +
  `AgentStateSnapshot`. Recommend yes (additive, back-compat; the
  consumer-pin already proved optional-field additions are safe).
- **D-MATCH** — pid match = "state-file pid ∈ terminal's pid subtree via the
  existing ppid walk" (reuse `lookupTerminalByPidChain` semantics) vs exact
  pid equality. Recommend subtree (CLIs fork; exact-pid is too brittle).
- **D-COLLISION** — if multiple state files match the pid subtree, tie-break
  by newest mtime (degrades to mechanism (c) — safe).

## 6. Sequencing & non-pre-emption

- This slice = decision-doc only → codex2 RQO32 gate.
- Impl AFTER gate: S1 = `pid` in canonical schema + pi emitter line +
  agentStateReader optional field + tests; S2 = terminal→sessionId resolver
  (pid-subtree match, cwd-mtime fallback) + tests; S3 = wire watchers to
  prefer the sessionId link when present. Each its own RQO32-gated slice.
- Pure coordinator-bucket robustness — does NOT pre-empt JWPK: B2-6
  subsystem/timing, ANTSCRIPT scope, @antDeep1/@antDeep2 placement stay
  parked for his headcount call. No headcount dependency here.

## 7. Asks of review

1. Ratify §1 scope + non-goals (esp. NOT a FINDING-2 refix).
2. Decide **D-LINK / D-SCHEMA / D-MATCH / D-COLLISION** (recommendations
   given).
3. Confirm decision-doc → RQO32 → S1/S2/S3 sequencing.
