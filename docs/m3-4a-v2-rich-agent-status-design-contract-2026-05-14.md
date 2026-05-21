# M3.4a-v2 Rich Agent Status — design contract

Date: 2026-05-14
Author: @evolveantclaude
Status: DESIGN-FIRST. No implementation claims until canonical @codex2 RQO gate PASS.
Cap: ≤260L (mirrors room-mode + responders + discussions + remote-ant contracts).
Anchors: JWPK FL2 answers locked 2026-05-13 — 4 states (idle/thinking/working/response-required), source priority status-line-fingerprint → hooks → ANT activity → PID, scope GLOBAL per agent, push-vs-poll hybrid.

## TL;DR

Rich agent status surfaces the operator-facing "what is this agent doing right now" signal beyond M3.4a-v1's pane/terminal delivery status. Four states (idle / thinking / working / response-required) computed from a source-priority cascade (status-line-fingerprint → push-hook → ANT activity → PID-cpu-sample). Status is GLOBAL per agent (one row per terminal, not per-room). Push is hook-driven; poll is fingerprint-driven. Existing M3.4a-v1 thin pane_status surface stays in place — agent_status is a parallel column on terminals, not a replacement.

## Q1 — Schema shape

| Option | Shape | Trade-off |
|---|---|---|
| 1a | `agent_status` TEXT column on `terminals` + new `chat_agent_status_events` history table | Familiar M3.b.4 pattern (mode + mode_history). Single row read for current; append-only history for audit. |
| 1b | Single `agent_status` column on `terminals`, no history | Smallest delta. No transition audit if needed later. |
| 1c | Separate `chat_agent_status` table keyed by terminal_id | Loses one-row-per-terminal invariant; needs JOIN every status read. |

**Recommendation: 1a.** Mirrors M3.b.4's `chat_room_modes` + `chat_room_mode_history` precedent. Current state is one column lookup; transition audit is append-only, GC-able later if it grows. Seven new columns on terminals carry the current snapshot + the input signals needed by Q3/Q5; the events table preserves transition history.

Schema (per canonical RQO B2 + 4INRH B3 — all required signals on terminals so Q3/Q5 derivation has explicit storage, not invented at implementation):
- `ALTER TABLE terminals ADD COLUMN agent_status TEXT NOT NULL DEFAULT 'idle' CHECK (agent_status IN ('idle','thinking','working','response-required'))`
- `ALTER TABLE terminals ADD COLUMN agent_status_source TEXT NOT NULL DEFAULT 'default' CHECK (agent_status_source IN ('fingerprint','hook','ant-activity','pid-cpu','default'))`
- `ALTER TABLE terminals ADD COLUMN agent_status_at_ms INTEGER NOT NULL DEFAULT 0`
- `ALTER TABLE terminals ADD COLUMN last_fingerprint_hash TEXT` — SHA256 of last tmux capture-pane output (Q3 input signal).
- `ALTER TABLE terminals ADD COLUMN last_fingerprint_at_ms INTEGER` — when last_fingerprint_hash was last refreshed (Q3 staleness check).
- `ALTER TABLE terminals ADD COLUMN last_message_sent_at_ms INTEGER` — touched on every successful chat message POST by this terminal's authorHandle (Q5 input signal).
- `ALTER TABLE terminals ADD COLUMN last_pty_byte_at_ms INTEGER` — touched on every successful PTY inject targeted at this terminal's tmux_target_pane (Q5 input signal).
- `CREATE TABLE chat_agent_status_events (id INTEGER PRIMARY KEY AUTOINCREMENT, terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE, prev_status TEXT, new_status TEXT NOT NULL, source TEXT NOT NULL, changed_at_ms INTEGER NOT NULL, evidence_json TEXT)`
- Index `idx_agent_status_events_terminal (terminal_id, changed_at_ms DESC)`

## Q2 — 4-state enum (FL2 LOCKED)

States, in display order (idle = default, response-required = most-attention-needing):

- **idle** — alive but no signal in the last N seconds. Default fallback when no source can decide otherwise.
- **thinking** — model is generating output (hash churning, no tool-call signature visible).
- **working** — executing tool calls / running commands (high CPU + recent PTY activity).
- **response-required** — an ask is awaiting the agent's answer (explicit hook push OR fingerprint regex match against common patterns).

JWPK explicitly dropped `blocked` and `offline` from the straw man. `idle` covers "no signal" implicitly. No fifth state.

**Response-required is a STATE in the agent_status enum, NOT a separate flag column** (per canonical RQO B4 lock). Adding a `response_required` boolean flag alongside agent_status would be a v3+ amendment requiring a new contract; v2 keeps single agent_status column, four states.

## Q3 — Status line fingerprint (PRIMARY source)

Primitives:
- `tmux capture-pane -t $target_pane -p -S -10` → tail 10 lines of pane output.
- SHA256 hash of capture output → `last_fingerprint_hash` on terminals.
- Diff vs previous hash → activity signal.

Polling cadence:
- Default 10 seconds per registered terminal with a tmux_target_pane.
- Polling daemon runs in-process (no separate worker) on a setInterval loop.
- Configurable per-instance via ANT_AGENT_STATUS_POLL_MS env (clamp 5s..60s).

Status derivation from fingerprint:
- Hash unchanged for >30s → idle.
- Hash changed within last 5s AND no tool-call signature → thinking.
- Hash changed AND tool-call signature visible (`⏺`, `🔧`, or `→ ` lines per common Claude Code / GPT CLI output) → working.
- Hash contains an explicit ask pattern (regex against `Awaiting` / `What should` / `Need direction` / `🙋‍♂️`) → response-required.

## Q4 — Push hook protocol (SECONDARY/FALLBACK source, if configured)

Hook-driven push for agents that can self-report:
- Hook installs via existing `ant hooks install <cli>` surface, gains a status-push helper.
- Hook POSTs to `POST /api/terminals/[id]/agent-status` with body `{ status, nonce, evidence_json? }`.
- Server validates `nonce` against the hook registration row in `terminals.meta` (registered at hook-install time, rotated on each push).

**Source priority (per canonical RQO B1 lock + FL2 anchor): fingerprint is PRIMARY when fresh (<30s unchanged). Hook push fires only when fingerprint is stale (>30s) OR ambiguous (e.g. fingerprint says idle but hook says response-required — hook informs the response-required-vs-idle disambiguation since the agent self-knows ask-awaiting state).** Fresh fingerprint decisions WIN over hook push for the basic idle/thinking/working classification. This matches the FL2 priority: fingerprint→hooks→ANT-activity→PID, where each later source only fires when the prior is stale or cannot decide.

Hook payload records source='hook' on the resulting agent_status_events row; subsequent fingerprint reads can override on the next poll cycle if the fingerprint disagrees.

## Q5 — ANT activity (TERTIARY source)

Heuristic from already-known ANT-internal signals:
- `last_message_sent_at_ms` on terminals: touched on every successful chat message POST.
- `last_pty_byte_at_ms` on terminals: touched on every successful PTY inject.
- Derivation: both recent (< 60s) → working; only message recent → response-required (typing); only pty recent → working; neither recent → idle.

Fires when fingerprint hash is stale (>30s) AND no hook push in 30s.

## Q6 — PID CPU sample (TIEBREAKER source)

Last-resort signal when fingerprint + hooks + activity are all stale:
- On-demand only — NO polling. Triggered when GET /api/terminals/[id]/agent-status is called.
- `ps -p <pid> -o %cpu=` parsed; "high" = >30% sustained over 3 samples spaced 200ms apart.
- High CPU → thinking. Low CPU → idle.
- Expensive but rarely needed; clamps the answer to idle/thinking only.

## Q7 — REST surface

```
GET  /api/terminals/[id]/agent-status
  → 200 { terminal_id, agent_status, agent_status_source, agent_status_at_ms, since_ms, evidence_json? }
  → 404 unknown terminal.
  Read-only. No pidChain.

PUT  /api/terminals/[id]/agent-status
  Body: { status, nonce, evidence_json? }
  → 200 { ...current row... } on accept; 401 on nonce mismatch; 400 on bad status.
  Auth: hook-nonce verified via terminals.meta hook registration.

GET  /api/chat-rooms/[roomId]/status?rich=1
  → 200 same shape as M3.4a-v1 status response, plus agent_status / agent_status_source / agent_status_at_ms fields per member when rich=1.
  → without rich=1 query param: identical to M3.4a-v1 response (no agent_status fields, fully backward compatible).
```

Per canonical RQO B3 + 4INRH B2 lock: the v2 room-scope surface EXTENDS the existing M3.4a-v1 `/api/chat-rooms/:roomId/status` route via `?rich=1` query param. There is NO separate `/agent-status` room-scope route. One discoverable status surface, two output modes.

## Q8 — CLI surface

**Locked: 8a per Q7 route shape** — extend `ant status show` with `--rich`. Single verb, mode-flag pattern. `ant status show --room ROOM_ID --rich` calls `GET /api/chat-rooms/:roomId/status?rich=1` and renders agent_status alongside pane_status. `ant status show --terminal TERMINAL_ID --rich` calls `GET /api/terminals/:id/agent-status` and renders single-terminal rich row. v1 thin surface is the default when --rich is absent — backward compatible.

## Q9 — Compat with M3.4a-v1 thin surface

v1 and v2 are PARALLEL, not replacement:
- `terminals.pane_status` (verified/stale/unknown) = M3.4a-v1 delivery state. Continues to ship.
- `terminals.agent_status` (idle/thinking/working/response-required) = M3.4a-v2 rich state. New column.
- Both visible in GET /api/chat-rooms/[id]/status response when --rich requested.
- Independent semantics: pane could be verified while agent is thinking. Both signals are useful.
- M3.4a-v2 implementation slice must NOT touch pane_status; M3.4a-v1 stays canonical for delivery status.

## Locked acceptance (implementation slice, AFTER this contract PASS + JWPK ACK)

- DDL append in SCHEMA_DDL_STATEMENTS: 7 new terminals columns (agent_status + source + at_ms + last_fingerprint_hash + last_fingerprint_at_ms + last_message_sent_at_ms + last_pty_byte_at_ms) + chat_agent_status_events table + index. Idempotent.
- Touchpoint wiring (so Q5 ANT-activity input signals are actually populated): chatMessageStore.postMessage → terminals.last_message_sent_at_ms = now (only when authorHandle resolves to a terminal). pty-inject-fanout.injectToPane → terminals.last_pty_byte_at_ms = now on successful enqueue. Both writes are best-effort, non-blocking on the caller.
- `agentStatusStore.ts` ≤200L: getAgentStatus, setAgentStatus (atomic — write row + append event), listEventsForTerminal.
- `agentStatusPoller.ts` ≤180L: setInterval daemon that walks terminals with non-null tmux_target_pane, capture-pane via spawnSync, hash, derive-state, call setAgentStatus when state changes. Default 10s; clamped 5s..60s via ANT_AGENT_STATUS_POLL_MS env.
- `fingerprintHasher.ts` ≤80L: pure function hash + parse + derive-state from capture output. Source-priority cascade implemented HERE: if hook push exists and fingerprint is stale-or-ambiguous → use hook; else use fingerprint decision (per Q4 lock).
- New /api/terminals/[id]/agent-status route ≤120L: GET + PUT handlers per Q7.
- Extend /api/chat-rooms/[id]/status route to honour `?rich=1` query param: when present, include agent_status + agent_status_source + agent_status_at_ms per member (per Q7 lock). Without rich=1, identical to v1 response.
- Extend scripts/ant-cli-status.mjs ≤140L: --rich flag handling per Q8.
- LIFT-not-COPY: any helper extracted from terminalsStore (e.g. last_seen tickers) stays single-source.
- M3.4a-v1 thin surface UNTOUCHED. agent_status is a parallel column, not a replacement for pane_status.

## Do-not-use

| Choice | Reason |
|---|---|
| Per-room agent_status | JWPK FL2 said GLOBAL per agent. Agent has one attention focus across rooms. |
| Auto-promote pane_status to agent_status | Different concepts. Pane is delivery; agent is attention. |
| Polling daemon as separate worker process | Process management overhead for an in-memory loop. setInterval in-process scales for 10s of terminals. |
| 5th state (blocked / offline) | JWPK explicitly dropped from straw man. idle covers "no signal" implicitly. |
| Synchronous PID CPU polling | Expensive. On-demand only. |

## Open questions for JWPK / team sign-off — LOCKED via coordinator delegation 2026-05-14

JWPK has explicitly delegated minor decisions to coordinator with "go with your recommendations and document all decisions" directive. Below 4 questions are locked at recommended defaults. JWPK can override at any check-in.

1. **Fingerprint poll cadence** — LOCKED: 10s default, configurable via `ANT_AGENT_STATUS_POLL_MS` env (clamp 5s..60s). Reason: responsive UX without server overhead at typical N<50 terminals.
2. **Hook nonce rotation** — LOCKED: PER-PUSH rotation. Each POST rotates the nonce; client receives new nonce in response for next push. Reason: stronger compromise resistance than session-scoped; modest server-side complexity. Hook helper handles rotation transparently.
3. **PID CPU threshold** — LOCKED: >30% sustained over 3 samples spaced 200ms apart. Fixed in v1, not configurable. Reason: 30% catches most "actively working" agents without false-positive on idle-with-background-load; configuration adds complexity for marginal value.
4. **Response-required regex set** — LOCKED initial set: `/Awaiting/i | /What should/i | /Need direction/i | /🙋‍♂️/`. Expand at implementation as new agent UIs surface ask patterns. Code-level constant, easy to expand without contract amendment.
5. ~~**CLI shape**~~ — RESOLVED IN DELTA-1: Q8 locked 8a (--rich flag on existing `ant status show`). No longer open.

## What I did NOT verify

- Did NOT prototype the poller daemon — cap-aware design only. Poll overhead at >50 terminals is unverified.
- Did NOT measure capture-pane SHA256 cost at scale — sketched as one spawnSync per terminal per 10s. Worth a microbench at implementation.
- Did NOT specify how the poller daemon starts/stops across server restarts — likely a setInterval initialised at app startup, cleared at SIGTERM. Implementation slice locks.
- Did NOT design the hook-install changes to ant-cli-hooks surface — hook helper needs to register a nonce + push helper. Implementation slice locks.
- Did NOT verify the response-required regex set works across Claude Code + Codex CLI + Cursor + other agent UIs — initial set covers Claude-class output, expand at implementation if a UI surfaces a new ask-pattern.

## Next step

Contract is canonical-PASSED 2026-05-14 (delta-1 + post-PASS delegation lock) and IMPLEMENTATION CLAIM-FIRST MAY PROCEED under the 5 locked defaults documented in the Open Questions section above. JWPK can override any default at any check-in via a one-line answer; such override would land as a delta-2 amendment, NOT a contract re-open.

cap-2 discipline applies; design-first established here means future implementer cannot widen scope without amendment.

End of contract.
