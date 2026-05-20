# PTY-INJECT-0 Design Contract — fresh-ANT terminal-feed sidecar

**Author:** researchant
**Date:** 2026-05-13 (revised after JWPK data-model clarification + 7 reviewer tightening points + 3 observer drop-in items + v3 source verification)
**Timebox:** 30 min compact, read-only
**Scope:** Lock the design contract for PTY-INJECT-A (registration/identity) and PTY-INJECT-B (tmux fanout). NO code in this slice. Address evolveantcodex's Q1-Q9 + tightening items B1-B7.
**Audience:** evolveantcodex (gate), claude2 (PTY-INJECT-A implementer), JWPK
**Constraint:** compact, not sprawling — per evolveantcodex's "no 2h doc" framing.

---

## TL;DR (revised B1, B7-refined per claude2 v3 source verification)

**Lift v3's PID-chain RESOLVER mechanics only (12L `processIdentityChain` ports clean) — the STORAGE is a deliberate redesign onto JWPK's two-entity model.** v3's global-handle `terminal_identity_roots` is NOT lifted; its function is consumed by the new `terminals` table. v3's `chat_room_members(room_id, session_id, alias)` is the closest existing precedent for `room_memberships(room_id, terminal_id, handle)` — same shape with cleaner naming.

Slice A adds `scripts/ant-cli-register.mjs` (matches the existing `scripts/ant-cli-chat.mjs` / `scripts/ant-cli-invites.mjs` pattern from the just-landed CLI-TAIL slice — NOT a new `cli/` directory), `src/lib/server/terminalsStore.ts` and `src/lib/server/roomMembershipsStore.ts`, plus `POST /api/identity/register`, `POST /api/identity/resolve`, `POST /api/sessions/add`. Slice B adds `src/lib/server/pty-inject-bridge.ts` (lifts v3 `ask-pty-bridge.ts` two-call protocol) and the message-fanout hook.

**v3-to-fresh-ANT clean mapping** (per claude2 source verification):

| v3 | fresh-ANT |
|---|---|
| `sessions WHERE type=terminal` (conflated entity) | `terminals(id, pid, name, agent_kind, pid_start)` (extracted, single-purpose) |
| `chat_room_members(room_id, session_id, alias)` | `room_memberships(room_id, terminal_id, handle)` |
| `terminal_identity_roots(root_pid, pid_start, handle)` | CONSUMED — `terminals` has pid+pid_start, identity is look-up-terminal-by-pid-tree |
| `--chain` opt-in flag in `cli/commands/register.ts` | DEFAULT-ON in `scripts/ant-cli-register.mjs` (server registers all ancestors, any descendant resolve works) |

**Per JWPK data-model clarification:** `terminals(id, pid, name, ...)` and `room_memberships(room_id, handle, terminal_id)`. Handles are room-scoped; `name` is operator-assigned and globally unique within the agreed namespace (B6 below). DB is runtime source-of-truth, replicated to Obsidian markdown as backup. Same terminal can be registered in v3 AND fresh-ANT simultaneously (no exclusion).

**Persistence call (B4):** ship A with bun:sqlite for the terminals + room_memberships tables specifically — does NOT wait on the broader persistence-doc decision but DOES create a deliberate split-store-backends state for one cycle. Risk explicitly named: rooms/messages/invites stay in-memory until the persistence-doc lands. Migration from in-memory rooms is a separate slice when persistence-doc Option B ships.

**Verified-target rule (B2):** unverified / stale / shell / unknown panes get NO paste at all — server emits a rate-limited room system-message naming the offline handle. Only verified agent panes (agent_kind set + prompt-state-poll fresh + last-bytes regex match) receive a paste-buffer + `\r`.

---

## Context — what v3 has (v3 source verified, B7), what fresh-ANT lacks

### v3 has (verified at db.ts just now, not citing memory alone)
- Table `terminal_identity_roots(id, root_pid, pid_start, handle, session_id, source, expires_at, meta)` with indices on `(root_pid, registered_at DESC)` and `expires_at`. Source: `src/lib/server/db.ts`.
- SQL functions: `INSERT INTO terminal_identity_roots …`, `resolveTerminalIdentity(pids, now)` doing the JOIN to sessions, `DELETE … WHERE expires_at <= ?` for cleanup.
- `src/lib/server/ask-pty-bridge.ts` (100L): `ptm.write()` two-call injection (text + `\r` at +150ms), `captureSource: 'chat_injection'`.
- `src/lib/server/pty-daemon.ts` (1109L): tmux paste-buffer-first write path, env-scrub on spawn, per-session `set-environment` for `ANT_SESSION_ID`.

### fresh-ANT has (verified at scripts/ just now)
- `scripts/ant-cli.mjs` (256L) — table-driven dispatcher landed via CLI-TAIL.
- `scripts/ant-cli-chat.mjs`, `scripts/ant-cli-invites.mjs`, `scripts/ant-cli-plan.mjs`, `scripts/ant-cli-plan-read.mjs` — module pattern, each ≤260L, with co-located `*.test.mjs`.
- NO identity / register / PTY-injection code.
- `src/lib/server/chatRoomStore.ts`, `chatMessageStore.ts`, `chatInviteStore.ts` — in-memory Maps, wiped on every restart.

### The gap
- PTY-INJECT-A creates `scripts/ant-cli-register.mjs` (+ test), `src/lib/server/terminalsStore.ts`, `src/lib/server/roomMembershipsStore.ts`, three API routes.
- PTY-INJECT-B creates `src/lib/server/pty-inject-bridge.ts` (lifts v3 ask-pty-bridge.ts shape) + message-fanout hook in `chatMessageStore.ts`.

---

## Q1 — Research / design contract first

This doc IS Q1. Compact, no separate sprawling research-doc, per evolveantcodex framing.

---

## Q2 — A → B split (mandatory)

CONFIRMED LOCKED. A passes BEFORE B is claimed.

- **A scope:** `scripts/ant-cli-register.mjs` (and test), `src/lib/server/terminalsStore.ts`, `src/lib/server/roomMembershipsStore.ts`, `POST /api/identity/register`, `POST /api/identity/resolve`, `POST /api/sessions/add`. **No live injection.**
- **B scope:** `src/lib/server/pty-inject-bridge.ts` (≤260L), `terminalsStore` row schema extended with `tmux_target_pane`, `pane_status`, `pane_stale_since`, `agent_kind`, message-fanout hook, verified-target check, per-recipient-queued 500ms batch flush, stale-marker emission, dual-registration sync.

---

## Q3 — Two-entity data model (per JWPK clarification)

```
terminals(
  id            TEXT PRIMARY KEY,
  pid           INTEGER NOT NULL,
  pid_start     TEXT,                  -- ps -o lstart=, PID-recycle guard
  name          TEXT UNIQUE NOT NULL,  -- operator-assigned, namespace per B6
  tmux_target_pane TEXT,               -- nullable, for incoming injection (slice B)
  agent_kind    TEXT,                  -- nullable enum (claude_code, codex, aider, ...)
  pane_status   TEXT DEFAULT 'unknown',-- 'verified' | 'stale' | 'unknown'
  pane_stale_since INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

room_memberships(
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  handle        TEXT NOT NULL,         -- ROOM-SCOPED, unique per (room_id, handle)
  terminal_id   TEXT NOT NULL REFERENCES terminals(id),
  created_at    INTEGER NOT NULL,
  UNIQUE(room_id, handle)
);
```

Indices: `terminals(pid, pid_start)` for resolve, `terminals(name)` UNIQUE, `room_memberships(room_id)`, `room_memberships(terminal_id)`.

### Routing chain on inject (slice B)
```
room receives message addressed to @target
  → SELECT terminal_id FROM room_memberships WHERE room_id = X AND handle = '@target'
  → SELECT pid, name, tmux_target_pane, pane_status, agent_kind FROM terminals WHERE id = ?
  → if tmux_target_pane present AND pane_status = 'verified' AND agent_kind set
    → enqueue for per-recipient 500ms batch flush (Q9)
    → on flush: tmux paste-buffer -t <pane> with envelope (preamble per below) + \r
  → else
    → emit ONE rate-limited room system-message: "@target appears offline (pane stale or unverified)" (B2)
```

### Outgoing identity chain (sender attribution)
```
CLI sends processIdentityChain() in body to POST /api/identity/resolve
  → server walks chain against terminals(pid, pid_start)
  → matched terminal_id
  → for the room being posted to: SELECT handle FROM room_memberships WHERE room_id = X AND terminal_id = Y
  → returns the room-scoped handle (or anonymous-with-warning if no membership)
```

### Pre-amble format on injected text
```
[ANT room <room-name> id=<room-id> msg=<message-id>] @<sender-handle>: <body>
```
Pre-amble is mandatory on every paste-buffer call. Plain text only. Example: `[ANT room ant-build id=7o873pyxk2 msg=msg_abc123] @claude2: heads up, slice-ready coming`.

### Lifecycle
- **DB as runtime source-of-truth.** terminals + room_memberships tables.
- **Obsidian markdown replication.** On every write + 5-min heartbeat, server writes current state to a markdown file in James's Obsidian vault (proposed path: `~/Documents/Obsidian/ant-registry/terminals.md` and `room-memberships.md` — JWPK to confirm exact vault path).
- **Retrospective registration.** `ant add session --pid X` or `ant add session --name Y` registers a terminal that wasn't registered at startup. `ant add membership --room R --handle @H --terminal-name N` adds a room membership. Useful for terminals already running before the registry came up. Implemented via `POST /api/sessions/add` route.
- **Dual registration.** Same terminal can be registered in BOTH v3 AND fresh-ANT simultaneously. Implementation per B5 below.

---

## Q4 — Enter contract (REVISED B2)

Verified-target check requires ALL THREE:
- `agent_kind` is set on the terminals row (not null)
- `pane_status = 'verified'` (last poll within 5 min)
- last bytes of pane match a known agent CLI prompt regex (allowlist: claude_code, codex, aider, gemini patterns)

Outcomes:
- **Verified, agent_kind = claude_code:** paste-buffer text (with preamble) + `\r` at +150ms + ANOTHER `\r` at +300ms (Claude Code TUI requires double-return per v3 ask-pty-bridge.ts source — verified by claude2's drop-in).
- **Verified, other agent_kind:** paste-buffer text (with preamble) + single `\r` at +150ms via two-call protocol (per `feedback_plain_text_pty`).
- **Unverified / stale / shell / unknown (revised B2):** **NO paste at all.** Server emits ONE rate-limited room system-message: `system: @<handle> appears offline (pane <pane_id> stale or unverified). Re-register with: ant register --handle @<handle> --pane $TMUX_PANE`. Rate-limit per Q7. Worker still sees the room message via their own tail / room-render and can reply through the standard CLI path.

This is the full lockout: no semi-paste, no notification-only paste, no compromise. If we can't verify the target, we don't touch the pane.

---

## Q5 — Scope: external tmux only

CONFIRMED. PTY-INJECT-B injects via `tmux paste-buffer -t <pane>` only. fresh-ANT does NOT spawn new PTYs in this slice. The Bun.Terminal vs node-pty PTY-rebuild question (`project_researchant_pty_decision_2026_05_12`) is orthogonal.

---

## Q6 — TMUX env scrub (REVISED B3, mandatory for EVERY child tmux command)

Per [[feedback_pty_daemon_no_nested_tmux]]: any child tmux command spawned by fresh-ANT MUST have `TMUX`, `TMUX_PANE`, `TMUX_PLUGIN_MANAGER_PATH` deleted from the env. **Reviewer tightening B3:** this rule applies to EVERY child tmux command, no exceptions — including `tmux paste-buffer`, `tmux list-panes`, `tmux capture-pane`, etc. Even though paste-buffer doesn't spawn nested tmux, the env discipline is uniform. Implementation: a single `runTmux(args)` helper in `pty-inject-bridge.ts` that always scrubs the env before spawning. All tmux calls go through this helper.

---

## Q7 — Stale targets (rate-limited, no retry storm)

- Failed `tmux paste-buffer -t <pane>` → mark `pane_status = 'stale'`, set `pane_stale_since = now`.
- Emit ONE room system-message: rate-limit 1 per handle per room per 60 min.
- Subsequent injects to a stale row: silent drop until re-register clears `pane_stale_since`.
- Re-register clears `pane_stale_since` AND emits a follow-up system-message: `system: @<handle> back online`.

---

## Q8 — Caller-PID resolution (REVISED for two-entity model + DEFAULT-ON chain)

`processIdentityChain()` ports from v3 verbatim (12L per claude2 source verification: walks `ps -o ppid=` from start_pid up, dedup via Set, max depth 32, captures pid_start via `ps -o lstart=` each step). Lives at `scripts/ant-cli-identity-chain.mjs` as a single function.

**KEY DIFFERENCE from v3:** chain walk is **DEFAULT-ON** in fresh-ANT. v3 had `--chain` as an opt-in flag in register; fresh-ANT registers all ancestors so any descendant resolve works without flag overhead. Reasoning per claude2: "less for agents to copy/paste; less to get wrong" (per [[feedback_shared_ant_config]]).

Server lookup updated:
- CLI sends `{pids: [{pid, pid_start}, ...]}` in POST body to `/api/identity/resolve` (NOT a header).
- Server walks chain against `terminals(pid, pid_start)`. Most-recent matching row wins.
- Returns `{terminal_id, name, agent_kind}`. The HANDLE is then re-resolved per-room from `room_memberships`.
- If no terminals row matches: server falls back to ANT_SESSION_ID env, then to `--name` flag, then to anonymous-with-warning.

**Observed registration gap (from researchant's hello-back probe just now):** posting to `/api/chat-rooms/.../messages` with `{"handle":"@researchant"}` was accepted with HTTP 201 BUT server overwrote `authorHandle` to `@you`. This confirms there's currently no auth/registration check on POST messages — the server takes whatever handle the client claims and may default to `@you` if the handle isn't recognised. PTY-INJECT-A `POST /api/identity/resolve` PLUS message-post-time terminal_id resolution is what closes this gap. Worth flagging as an observed real-state finding.

---

## Q9 — Fanout strategy under burst (per claude2 observer drop-in)

Per [[project_focus_mode]] v3 lesson: raw per-message-immediate fanout is unsustainable. Recommendation: **Option 9b — per-recipient-queued with batch flush.**

- Per-handle in-memory queue. New message → enqueue → if queue empty, schedule 500ms flush.
- Flush callback: paste-buffer ALL queued messages as ONE envelope (`[ANT room ant-build] 3 messages: @a: …, @b: …, @c: …`), then `\r` if verified-target.
- Bypass for high-priority traffic: `@JWPK` mentions OR explicit priority flag → flush queue immediately. Limit: 3 bypasses per recipient per 10 min, then drop back to queued mode.
- Acceptance bullet 11 added to PTY-INJECT-B: synthetic burst test (5 messages in 100ms) sees ONE envelope, not 5 paste events.

---

## NEW: Tightening B4 — Persistence-decision collision (REVISED 2026-05-13 02:00)

JWPK said registry is DB-runtime source-of-truth. The broader persistence call ([[project_researchant_persistence_decision_2026_05_12]]) is still pending JWPK. Two options:

| Option | Approach | Migration risk |
|---|---|---|
| B4a | Wait for persistence decision before A | Blocks A on a separate JWPK call |
| B4b-v1 (WRONG) | Ship A with bun:sqlite ONLY for terminals + room_memberships | **DOES NOT WORK** — see runtime correction below |
| B4b-v2 (CORRECT) | Ship A with better-sqlite3 + ABI-mitigation pattern, ONLY for terminals + room_memberships | Split-store-backends; explicit migration when persistence-doc lands |
| B4c | Ship A with in-memory terminalsStore matching the chatRoomStore pattern; migrate when persistence-doc lands | Identity wipes on every restart, defeats JWPK's DB-runtime requirement |

**Runtime correction baked in 2026-05-13 02:00:** the original B4b recommendation (bun:sqlite) was WRONG given the actual runtime. Verified empirically by claude2: `lsof -p <com.ant.fresh-pid>` reveals the live server is `/Users/jamesking/.nvm/versions/node/v20.19.4/bin/node`, NOT bun. The plist's `ProgramArguments = /Users/jamesking/.bun/bin/bun run start` is misleading — `bun run start` invokes the npm `start` script which is literally `HOST=0.0.0.0 PORT=6461 node build/index.js`. So bun-the-launcher spawns node-the-runtime; the SvelteKit handler runs under Node. `import('bun:sqlite')` fails under Node with "Only URLs with a scheme in: file, data, and node are supported". This is exactly the [[feedback_better_sqlite3_abi_mismatch]] incident class — except the trap was hidden by the bun-spawns-node pattern.

**Recommendation: B4b-v2** — better-sqlite3 with the ABI-mitigation pattern from the existing memory rule:
- Pin install to nvm v20.19.4 binary explicitly (postinstall hook does `PATH=/Users/jamesking/.nvm/versions/node/v20.19.4/bin:$PATH npm rebuild better-sqlite3`)
- Smoke-test BEFORE any other code: a small probe script that opens the DB, runs a CREATE TABLE + INSERT + SELECT, prints PASS or FAIL. This script runs as a pre-execution gate per coordinator.
- Header comment on `terminalsStore.ts` documents the ABI pattern + nvm pin requirement (so the next person to edit doesn't bare `npm install` and break it)

This keeps split-store-backends (rooms/messages/invites in-memory until persistence-doc lands) but uses the right driver for the actual runtime.

**Do not pivot fresh-ANT to bun-as-runtime tonight** — that's a service-runtime migration with broader scope (per gate decision). Slot-in better-sqlite3 within the existing Node runtime, lock the ABI pattern, ship.

**Researchant doc-bug self-correction:** v2 doc's original B4b recommendation conflated "fresh-ANT requires bun >=1.3.13 in package.json" (true) with "fresh-ANT runs under bun at runtime" (FALSE — the SvelteKit production handler runs under Node v20.19.4 invoked by bun's `start` script). The lesson is captured in `feedback_verify_runtime_via_lsof_not_plist.md`.

---

## NEW: Tightening B5 — Dual registration semantics

v3 :6458 has been intermittently unreachable (15s timeouts confirmed during this very session). If `ant register` writes to BOTH v3 and fresh-ANT, the semantics under v3 flakiness need naming.

| Option | Semantics | Failure behaviour |
|---|---|---|
| B5a | Strict-both | If either fails, the registration fails. Worker is unregistered if v3 is down. |
| B5b | Primary-with-best-effort-mirror | fresh-ANT is primary; v3 is best-effort. Mirror retried in background. |
| B5c | At-least-once-with-retry / sync | Try both; record which succeeded; background sync retries the missing side every N seconds. |

**Recommendation: B5b — fresh-ANT primary, v3 best-effort-mirror.**

- `ant register` POSTs to fresh-ANT first. If fresh-ANT succeeds, return success to the user.
- Then in background, attempt v3 mirror. If it fails, queue for retry (max 3 attempts, exponential backoff). Log the v3-mirror status separately.
- The user is never blocked on v3 reachability for fresh-ANT registration.
- A separate `ant register --sync` command lets the user manually re-trigger v3 mirroring if needed.

Why not B5a: defeats the bridge-backed-live-trial under any v3 flakiness.
Why not B5c: more complex than B5b for the same outcome.

---

## NEW: Tightening B6 — Name uniqueness scope

JWPK said "globally unique" for `name`. "Globally" needs precision.

| Option | Namespace | Conflict behaviour |
|---|---|---|
| B6a | Mac-local | UNIQUE per machine. Conflicts impossible across Macs. |
| B6b | Server-local (per fresh-ANT instance) | UNIQUE per server. Two Macs running fresh-ANT have separate namespaces. |
| B6c | Tailnet-wide | UNIQUE across the user's Tailnet. Requires central registry. |
| B6d | Operator-owned (one human, multiple Macs) | UNIQUE per James across all his machines. Effectively B6c with operator scope. |

**Recommendation: B6a (Mac-local) for M0, with `name@host` syntax as future-proofing.**

- For now, `name` is UNIQUE within the single fresh-ANT instance running on Mac mini M4 Pro. Conflicts within this Mac fail at registration with `name 'X' already in use by terminal Y (pid Z)`.
- Future-proof: when a second Mac comes online, fully-qualified `name@host` resolves the namespace question (e.g. `claude2@mac-mini-m4` vs `claude2@macbook-pro`). Single-name lookup falls back to the local host.
- This matches v3's existing single-Mac assumption (per [[project_v3_architecture]]) and doesn't require new central infrastructure.

JWPK should explicitly confirm this is the right scope for M0.

---

## Locked acceptance — PTY-INJECT-A (REVISED for B1, B4b)

Required evidence before A passes:
1. `scripts/ant-cli-register.mjs` exists (≤260L, follows ant-cli-chat.mjs / ant-cli-invites.mjs pattern). Co-located `scripts/ant-cli-register.test.mjs`.
2. `scripts/ant-cli.mjs` dispatch table updated to route `register` and `add session` verbs (stays ≤260L per existing cap).
3. `src/lib/server/terminalsStore.ts` (≤260L) exports `bun:sqlite` table operations matching the schema in Q3.
4. `src/lib/server/roomMembershipsStore.ts` (≤260L) exports `bun:sqlite` table operations matching the schema in Q3.
5. `POST /api/identity/register` accepts `{pid, pid_start, name, ttl_seconds, source, meta?}`. TTL clamped 60s-24h, default 12h. Returns `{terminal_id, name, expires_at}`.
6. `POST /api/identity/resolve` accepts `{pids: [{pid, pid_start}, ...], room_id?}`. Returns `{terminal_id, name, handle?}` where handle is filled if `room_id` provided AND a `room_memberships` row exists.
7. `POST /api/sessions/add` accepts `{pid?, name, room_id?, handle?}` for retrospective registration (B5 dual-reg writes to fresh-ANT here, mirrors to v3 best-effort).
8. Tests: `scripts/ant-cli-register.test.mjs` covers `processIdentityChain()`, register-then-resolve round-trip, name-uniqueness conflict (B6a), retrospective add-session.
9. Real-shell round-trip: `ANT_SERVER_URL=http://<ANT_SERVER_HOST>:6461 node scripts/ant-cli.mjs register --name researchant-test` from a fresh shell → server stores row → `POST /api/identity/resolve` with the same shell's PID chain → returns `terminal_id`. Then `ant add membership --room ant-build --handle @researchant-test --terminal-name researchant-test` → resolve returns `handle = '@researchant-test'`.
10. NO injection code in this slice. `pty-inject-bridge.ts` does NOT exist after A.
11. fresh-ANT v3 /ant 200 (untouched). Live `/api/chat-rooms` still returns ant-build + ant-evolve. `bun:sqlite` is added as a dep but only used for the two new stores (B4b explicit split).
12. Obsidian markdown replication writes to a smoke-test path on every register (verifies the pattern works; full vault path JWPK-confirmed as separate).

---

## Locked acceptance — PTY-INJECT-B (REVISED for B2, B3, Q9)

Required evidence before B passes:
1. `src/lib/server/pty-inject-bridge.ts` exists, ≤260L, lifts the v3 `ask-pty-bridge.ts` shape.
2. `terminalsStore` schema extended with `tmux_target_pane`, `pane_status`, `pane_stale_since`, `agent_kind`.
3. `ant register --pane $TMUX_PANE --agent-kind claude_code` extends an existing terminals row (does NOT create a duplicate; matches by `name`).
4. Message-fanout hook in `src/lib/server/chatMessageStore.ts` calls the bridge for every message.
5. Bridge resolves `room_memberships` for the room → terminals row → if `tmux_target_pane` present + `pane_status = 'verified'` + `agent_kind` set → enqueue. Else emit rate-limited stale system-message.
6. Verified-target check (≤30L helper): agent_kind set + pane_status = 'verified' + last-bytes regex match.
7. **B2 strict (revised):** unverified / stale / shell / unknown panes get **NO paste at all**. Only the room system-message.
8. **B3 strict (revised):** every child tmux command goes through `runTmux(args)` helper that scrubs `TMUX`, `TMUX_PANE`, `TMUX_PLUGIN_MANAGER_PATH` from env.
9. Plain-text envelope per Q3 pre-amble format. NO ANSI codes.
10. Stale handling per Q7: mark stale, ONE rate-limited system-message per handle/room/60min, silent-drop subsequent until re-register.
11. **Q9 burst handling:** per-recipient-queued 500ms batch flush. Synthetic-burst test (5 messages enqueued in 100ms) sees ONE envelope, not 5 paste events. Bypass-counter per recipient (3-per-10min limit).
12. Live proof: claude2 sends a message to ant-build addressed to `@researchant` via `/api/chat-rooms/.../messages`; the message lands in researchant's tmux pane as plain-text envelope; `\r` is included only because researchant's terminals row had `agent_kind: claude_code`. Synthetic test confirms unverified target gets ONLY the room system-message, not a paste.
13. fresh-ANT v3 /ant 200 (untouched). No PTY-cap exhaustion (`lsof /dev/ptmx` unchanged before/after).

---

## Do-not-use

| Choice | Reason |
|---|---|
| **New `cli/` directory (B1)** | fresh-ANT pattern is `scripts/ant-cli-<verb>.mjs` modules with co-located tests. Match the CLI-TAIL precedent. |
| **Header-based PID transport** | Body, not header. Auditable, explicit, doesn't get stripped by middleware. |
| **WS terminal_input for inject** | The WS path is for browser-side terminal sessions. Use `tmux paste-buffer` directly via `runTmux()`. |
| **ANSI escape codes for envelope** | Plain text only per [[feedback_plain_text_pty]]. |
| **Spawning nested tmux from the bridge** | Use existing tmux server only. If a future helper needs `tmux new-session`, B3 env scrub is mandatory. |
| **Auto-Enter on message kind** | Q4 — verified-target-state only. |
| **Persistent retry on stale panes** | Q7 — single rate-limited system-message + silent-drop. |
| **Strict-both dual-registration (B5a)** | Defeats bridge-backed-live-trial under v3 flakiness (which is real, observed today). |
| **Identity in-memory only (B4c)** | Defeats JWPK's DB-runtime-source-of-truth requirement. |

---

## What I did NOT verify (timebox honesty)

- v3's exact `meta` column type (TEXT/JSON/blob) — read the column list, did not inspect the type.
- Whether `bun:sqlite` correctly handles concurrent writes from the SvelteKit server + the pty-inject-bridge background queue. WAL-mode should make this safe but unverified.
- Whether the verified-target prompt-state-poll regex allowlist works for all common agent CLI prompts (Claude Code, Codex, Aider, Gemini). Likely yes for the first three; Gemini varies. Implementation slice should test against real prompts.
- Whether Obsidian markdown replication should be atomic-write (write-temp + rename) or simple-truncate. Atomic-write is safer; should be the default in B4b.
- Confirmed observation: posting to `/api/chat-rooms/.../messages` with a claimed handle currently gets the handle overwritten to `@you` (server has no handle-auth gate). PTY-INJECT-A's `/api/identity/resolve` is the fix, but the message-POST endpoint also needs to consult resolve before accepting a claimed handle.

---

## Next step

If evolveantcodex accepts this revised contract: claude2 claims **PTY-INJECT-A** with the 12-item locked acceptance. researchant standby for design questions during implementation; will not write code.

If evolveantcodex wants further amendments: list specific revisions and researchant takes another tightening pass.

End of contract (revised).
