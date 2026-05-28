# remoteant MCP-stdio Adapter — Phase E1 Spec

**Status**: DRAFT. Pending JWPK ratification of bridge=C direction (per
`mem_project_local_bridge_architecture_2026_05_27.md` open question — JWPK
must pick C before code lands).

**Plan**: ant-verification-2026-05-28
**Milestone**: `e1-remoteant-spec`
**Drafter**: @speedyclaude (on behalf of @speedycodex who owns the milestone)
**Owner ratification path**: JWPK ratifies → @speedycodex claims E1 closed →
@homebrewclaude picks up E2 (antchat-Mac lifecycle integration) → @antiosclaude
picks up E3 (iOS bridge consumption — stub already shipped).

**Substrate dependencies (existing, no new infra required for E1)**:
- ANT daemon at `:6174` (already serves both `ant` CLI + `mcp-server-ant`
  translators) — see archaeology in `mem_project_local_bridge_architecture_2026_05_27.md`
- `packages/mcp-server-ant/` (per-client stdio↔HTTP translator,
  3 concurrent instances measured 2026-05-27) — to be deprecated as a
  thin wrapper around `remoteant --mcp-stdio` in Phase 5
- `remoteant` binary (currently "lite-ANT for agents"; promoted to
  unified MCP+CLI+HTTP sidecar in this spec)
- `/api/browser-session` endpoint (existing, used by antchat-Mac to mint
  per-user session cookies)
- `/api/orgs` endpoint (Slice 14, SHA `6d57e8b`) — consumed by Phase 3
  `ant.orgs.list` method

---

## 1. Scope

Phase E1 ships ONLY this spec — no code. Phases 1–5 (defined in section 7)
gate subsequent milestones. The spec covers:

1. Architecture under bridge=C (locked direction)
2. Process lifecycle (spawn / respawn / reap / health)
3. Stdio JSON-RPC contract (request/response/error shapes + `ant.*` namespace)
4. Auth (admin-token inheritance, per-client bearer, session-cookie mint)
5. MCP client config that antchat ships
6. Five-phase delivery sequence
7. Acceptance criteria (mirrored from plan)

Out of scope for E1:
- iOS-over-network bridge consumption (E3 lane, stub already shipped)
- Deprecation of `mcp-server-ant` npm package (Phase 5 work, not E1 spec)
- Identification + retirement of mystery `:6176` process (Phase 1 of the
  bridge plan, not gated by this spec)

---

## 2. Architecture (bridge=C)

`remoteant` is promoted from "lite-ANT for agents" to **the canonical local
sidecar** — one process serving stdio-MCP + HTTP + (future) optional
remote-server bridge.

Each MCP client (antchat-Mac, Claude Desktop, Cursor, Claude Code, …) spawns
its own `remoteant --mcp-stdio` instance. That instance translates
MCP JSON-RPC over stdio into HTTP calls against the local ANT daemon at
`:6174`.

```
+------------------+   stdio (JSON-RPC 2.0,    +------------------+   HTTP
| MCP client       |   newline-delimited)      | remoteant        |   (Bearer
| (antchat-Mac,    | <-----------------------> | --mcp-stdio      | <-cookie-> ANT daemon
| Claude Desktop,  |                           | adapter instance |   pidChain   :6174
| Cursor, …)       |                           +------------------+              |
+------------------+                                                              v
                                                                              SQLite WAL
                                                                              (build-snapshot
                                                                              or live-dev)
```

Key invariants:
- ANT daemon at `:6174` IS the bridge (per archaeology). `remoteant` is the
  stdio adapter wrapper.
- One `remoteant` process per MCP client (matches today's mcp-server-ant
  shape — 3 concurrent instances measured).
- `ant` CLI continues to talk HTTP directly to `:6174` — unchanged.
- Antchat-Mac's lifecycle owns the `remoteant` it spawns (E2 lane).

---

## 3. Process Lifecycle

### 3.1 Spawn

Two supported launch modes:

**Mode A — In-process supervise (default for antchat-Mac)**:

Antchat-Mac launches `remoteant` via `NSTask` (Swift `Process` API) on
`applicationDidFinishLaunching:`. The remoteant binary is bundled at:

```
/Applications/Antchat.app/Contents/Resources/remoteant
```

Standard Swift app bundle convention. The binary is code-signed as part of
antchat's release pipeline.

**Mode B — LaunchAgent (opt-in, persistent across antchat restarts)**:

User runs `antchat install-launch-agent` to drop a plist at:

```
~/Library/LaunchAgents/run.ant.remoteant.plist
```

Mode B is for users who want `remoteant` available to other MCP clients
(Claude Desktop, Cursor) even when antchat-Mac is quit. Mode A remains the
default to keep first-run friction low.

### 3.2 Respawn (crash recovery)

Antchat-Mac watches its supervised `remoteant` process. On unexpected exit:

- Log exit code + stderr tail to `~/Library/Logs/antchat/remoteant.log`
- Wait 1s, respawn
- Exponential backoff on repeated crashes (1s → 2s → 4s → 8s → 16s, capped
  at 30s)
- After 5 consecutive crashes within 60s, surface a user-visible toast
  ("ANT bridge unstable — see logs") and stop auto-respawn until next
  antchat launch.

LaunchAgent mode delegates respawn to launchd (`KeepAlive` with
`Crashed`/`SuccessfulExit:false` triggers).

### 3.3 Reap (graceful shutdown)

On `NSApplicationWillTerminate` (or equivalent quit signal):

1. Send `SIGTERM` to remoteant child PID
2. Wait up to 5s for clean exit (remoteant flushes any in-flight stdio
   responses, closes HTTP keep-alive sockets to `:6174`)
3. Send `SIGKILL` if still alive after grace period
4. Reap zombie with `waitpid`

LaunchAgent mode: antchat-Mac does NOT reap; launchd-managed remoteant
outlives antchat by design.

### 3.4 Health check

remoteant accepts a stdio JSON-RPC method `ant.ping` (no params, returns
`{ ok: true, daemonReachable: bool, daemonUrl: string }`).

Antchat-Mac issues `ant.ping` every 10s. After 3 consecutive missed
responses (30s) the supervisor considers remoteant unhealthy and triggers
the respawn flow even if the process is still alive.

remoteant itself probes the daemon at `:6174` on a 10s interval; if the
daemon is unreachable, `daemonReachable: false` is returned and subsequent
`ant.*` calls fail fast with `error.code: -32001` (daemon unreachable)
instead of timing out at the HTTP layer.

---

## 4. Stdio JSON-RPC Contract

remoteant `--mcp-stdio` mode implements standard MCP protocol (JSON-RPC 2.0
over newline-delimited stdio, one message per line).

### 4.1 Method namespace

All ANT methods live under the `ant.*` prefix:

| Method                  | Maps to                                  |
|-------------------------|------------------------------------------|
| `ant.ping`              | (internal — health check)                |
| `ant.rooms.list`        | `GET /api/chat-rooms`                    |
| `ant.rooms.get`         | `GET /api/chat-rooms/[roomId]`           |
| `ant.chat.send`         | `POST /api/chat-rooms/[roomId]/messages` |
| `ant.chat.history`      | `GET /api/chat-rooms/[roomId]/messages`  |
| `ant.plans.show`        | `GET /api/plans/[planId]`                |
| `ant.tasks.list`        | `GET /api/tasks?planId=…`                |
| `ant.tags.apply`        | `POST /api/tags`                         |
| `ant.status`            | `GET /api/status`                        |
| `ant.orgs.list`         | `GET /api/orgs` (Slice 14, SHA 6d57e8b)  |

Phase 3 expands this to the full ~50-method surface (see section 7).

### 4.2 Request shape

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "ant.rooms.list",
  "params": { "archived": false, "limit": 50 }
}
```

### 4.3 Response shape (success)

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": {
    "rooms": [
      { "id": "O393IH1zFgd_nujpQgnof", "title": "Main Dev", "memberCount": 12 }
    ]
  }
}
```

### 4.4 Response shape (error)

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "error": {
    "code": -32001,
    "message": "ANT daemon unreachable at http://localhost:6174",
    "data": { "lastReachable": "2026-05-28T09:14:22Z", "lastError": "ECONNREFUSED" }
  }
}
```

Error code map:
- `-32700` parse error (malformed JSON)
- `-32600` invalid request (missing `method` / `id`)
- `-32601` method not found (no `ant.*` method matches)
- `-32602` invalid params (validation failure)
- `-32603` internal error (uncaught exception in adapter)
- `-32001` daemon unreachable (HTTP layer to `:6174` failed)
- `-32002` auth failure (daemon returned 401/403)
- `-32003` rate-limited (daemon returned 429)

### 4.5 Tool discovery

Standard MCP `tools/list` returns the available `ant.*` methods with their
JSON schemas:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

Response includes each tool with `name`, `description`, `inputSchema`. Phase 2
ships discovery for the 5 baseline methods; Phase 3 expands.

---

## 5. Auth

### 5.1 Default — admin token inheritance

remoteant inherits `ANT_ADMIN_TOKEN` from its spawn environment. Antchat-Mac
reads the token from the macOS Keychain (item:
`run.ant.antchat.admin-token`) and sets it before NSTask launch:

```swift
var env = ProcessInfo.processInfo.environment
env["ANT_ADMIN_TOKEN"] = keychainAdminToken
env["ANT_SERVER_URL"] = "http://localhost:6174"
task.environment = env
```

remoteant stamps every outbound HTTP request with `Authorization: Bearer
$ANT_ADMIN_TOKEN`.

### 5.2 Per-client bearer (v2, optional)

For multi-tenant scenarios (one Mac, multiple human users sharing the
daemon — uncommon today but planned), antchat generates a short-lived
per-client bearer token via `POST /api/auth/issue-client-token` and passes
it to remoteant via env var `ANT_CLIENT_BEARER`. remoteant prefers the
client bearer when present, falls back to admin token.

Not required for E1 ship — admin-token inheritance is sufficient for the
single-user antchat-Mac case.

### 5.3 Session cookie path (for endpoints that need user context)

A handful of endpoints (e.g. `/api/me`, `/api/memory/*`) resolve the
caller's identity from a session cookie rather than a Bearer token. For
these, remoteant calls `POST /api/browser-session` against `:6174` with the
admin token + resolved handle, receives a session cookie, and stamps
subsequent requests with both `Authorization: Bearer …` AND the
`Cookie: ant_session=…` header.

The handle resolution is environment-driven: `ANT_AS_HANDLE=@speedyclaude`
in remoteant's env causes it to mint sessions as that handle. Antchat-Mac
sets this on spawn based on the active user.

---

## 6. MCP Client Config (antchat ships)

Antchat-Mac writes its MCP config to:

```
~/Library/Application Support/Antchat/mcp-config.json
```

Sample contents:

```json
{
  "mcpServers": {
    "ant": {
      "command": "/Applications/Antchat.app/Contents/Resources/remoteant",
      "args": ["--mcp-stdio", "--server-url", "http://localhost:6174"],
      "env": {
        "ANT_ADMIN_TOKEN": "$KEYCHAIN:run.ant.antchat.admin-token",
        "ANT_AS_HANDLE": "@speedyclaude"
      }
    }
  }
}
```

The `$KEYCHAIN:…` syntax is antchat-Mac's own indirection — when antchat
spawns remoteant it resolves the Keychain reference and sets the literal
env var. Other MCP clients (Claude Desktop, Cursor) writing the same
config substitute literal values or use their own secret-management
shape — out of scope for E1.

LaunchAgent mode (3.1 Mode B) writes a parallel config at the same path
but with `args: ["--mcp-stdio", "--server-url", "http://localhost:6174",
"--launch-agent-mode"]` so remoteant skips antchat-specific bootstrapping.

---

## 7. Five-Phase Delivery Plan

### Phase 1 — Adapter scaffold

Build `remoteant --mcp-stdio` mode as a Swift CLI binary in
`Antchat.app/Contents/Resources/remoteant`. Reads JSON-RPC from stdin,
writes JSON-RPC to stdout, logs to stderr. No `ant.*` methods yet — only
`ant.ping` + `tools/list` (returns empty array). Acceptance: antchat-Mac
can spawn the process, send `ant.ping`, receive `{ ok: true }`, kill with
SIGTERM cleanly.

### Phase 2 — Five baseline methods + discovery

Implement the five baseline `ant.*` methods (rooms.list, chat.send,
plans.show, tasks.list, status) with full JSON schemas exposed via
`tools/list`. Each method maps to one HTTP endpoint on `:6174`. Acceptance:
antchat-Mac can list rooms, send a chat message, fetch a plan, list tasks,
and read daemon status via stdio JSON-RPC — all surfaces measured working
end-to-end.

### Phase 3 — Full ~50-method surface

Expand `ant.*` to cover the existing `/api/` surface: `ant.rooms.*`
(CRUD + members + memory attach), `ant.chat.*` (history + reactions +
edits), `ant.plans.*` (create + milestones + claims), `ant.tasks.*`,
`ant.tags.*`, `ant.terminals.*`, `ant.agents.*`, `ant.identity.*`,
`ant.memory.*`, `ant.artefacts.*`, `ant.decks.*`, `ant.verification.*`,
`ant.orgs.*` (Slice 14, SHA `6d57e8b`). One method per endpoint;
auto-generated where possible from OpenAPI/route inventory. Acceptance:
parity with `ant` CLI's HTTP surface — anything callable via CLI is
callable via stdio.

### Phase 4 — Crash recovery + LaunchAgent + health checks

Implement the lifecycle behaviour in section 3 in production-grade form:
exponential-backoff respawn, structured logs, `ant.ping` heartbeat,
LaunchAgent install path (`antchat install-launch-agent`), graceful
SIGTERM/SIGKILL on antchat quit. Acceptance: kill -9 remoteant manually;
antchat respawns within 2s; second crash within 5s slows backoff to 2s;
five crashes in 60s triggers user-visible toast.

### Phase 5 — Per-client auth + session cookies + admin fallback

Implement section 5.2 (per-client bearer) and 5.3 (session cookie mint).
Deprecate `packages/mcp-server-ant/` npm package as a thin wrapper
spawning `remoteant --mcp-stdio` for backwards compat with non-antchat
MCP clients. Acceptance: Claude Desktop running the deprecated
mcp-server-ant package transparently exec's remoteant; existing three
tools (`ant_get_pending_mentions`, `ant_post_message`, `ant_list_rooms`)
keep working unchanged.

---

## 8. E2 Dependency — antchat-Mac Lifecycle Integration

E2 milestone (@homebrewclaude's lane) consumes this spec. E2's
`applicationDidFinishLaunching:` sequence must include:

1. Read admin token from Keychain (item `run.ant.antchat.admin-token`)
2. Spawn `Contents/Resources/remoteant --mcp-stdio` with env from section 5.1
3. Register the spawned process in antchat's MCP server registry (the
   same registry that backs the Bridges strip — see
   `mem_project_bring_in_llm_buttons_2026_05_23.md`)
4. Subscribe to NSTask termination notifications; on unexpected exit run
   the respawn flow (section 3.2)
5. On `NSApplicationWillTerminate`, run the reap flow (section 3.3)

E2 acceptance criteria SHOULD reference this spec section verbatim so the
contract stays load-bearing across milestones.

---

## 9. E3 Dependency — iOS Bridge Consumption

E3 milestone (@antiosclaude's lane, stub already shipped per session log)
wires antios to the same remoteant process WHEN iOS device + Mac are on
the same physical host (rare — iOS simulator on the Mac, or future native
iPad Pro running antios alongside antchat). In that case antios uses
local stdio to a sibling remoteant invocation.

When iOS is on a different device (common case), antios connects to a
remote ANT daemon over HTTPS — out of E1 scope. The remote daemon
exposes the SAME HTTP surface as the local `:6174`, so the contract in
section 4 is reusable; only the transport changes (stdio → HTTPS).

E3 stub should document the transport-selection logic but does not gate
E1 ship.

---

## 10. Acceptance Criteria (mirrored from plan)

1. **Adapter spec covers process lifecycle (spawn/respawn/reap), stdio
   JSON-RPC contract, auth.** Sections 3, 4, 5 cover this verbatim;
   each sub-section is concrete enough for @speedycodex or
   @homebrewclaude to implement without further design questions.

2. **antchat spawns remoteant on launch (LaunchAgent or in-process
   supervise) with crash-recovery; graceful shutdown on quit.** Section
   3.1 (Mode A in-process / Mode B LaunchAgent), section 3.2 (respawn
   with exponential backoff), section 3.3 (SIGTERM/SIGKILL graceful
   shutdown). The implementation of these behaviours lands in E2
   (@homebrewclaude's lane) — E1 ships the spec only.

---

## Open assumptions (parent-agent to validate before commit)

The user vault memory `mem_project_local_bridge_architecture_2026_05_27.md`
pinned the bridge=C direction + 5-phase sequence but left these
sub-decisions implicit. Drafter made these assumptions; parent-agent
should validate with JWPK before commit:

1. **remoteant binary location**: assumed `/Applications/Antchat.app/Contents/Resources/remoteant`
   (Swift app bundle convention). Alternatives: `/usr/local/bin/remoteant`
   (Homebrew-style), `~/.ant/bin/remoteant` (user-local). Bundle path
   chosen for tight lifecycle coupling with antchat-Mac.

2. **LaunchAgent label**: assumed `run.ant.remoteant.plist` matching the
   `run.ant.*` keychain item naming. JWPK has not pinned this convention
   in writing.

3. **Per-client bearer endpoint name**: assumed
   `POST /api/auth/issue-client-token`. This endpoint does NOT exist
   today — Phase 5 must ship it. Name is illustrative.

4. **Health-check cadence**: assumed 10s ping interval, 3-miss threshold,
   30s timeout-to-respawn. No prior art in vault memory; chose values
   that feel right for desktop-app supervisor cadence.

5. **Crash-toast threshold**: assumed 5 crashes within 60s → user-visible
   warning. Conservative — prevents pathological loop without nuisance
   toasts on single transient failures.

6. **iOS bridge transport**: section 9 assumes iOS connects to a REMOTE
   daemon over HTTPS when not co-located with antchat-Mac. Vault memory
   doesn't pin this; could equally be Tailscale-tunneled local connection
   to the user's Mac mini.

7. **`mcp-server-ant` deprecation timing**: Phase 5 deprecates the npm
   package as a thin wrapper. Vault memory says "deprecated; leave as
   shim for backwards-compat" — assumed shim approach (not hard
   deletion) for non-antchat MCP clients.

---

Related memory:
- `mem_project_local_bridge_architecture_2026_05_27.md` (canonical
  bridge=C archaeology + recommendation)
- `mem_project_pid_as_identity_model_2026_05_21.md` (identity model that
  remoteant inherits unchanged)
- `mem_project_bring_in_llm_buttons_2026_05_23.md` (MCP server registry
  in antchat-Mac that E2 hooks into)
- `mem_feedback_spec_freeze_should_be_a_doc_not_iterated_messages_2026_05_27.md`
  (why this spec is a doc, not an in-room iteration)
