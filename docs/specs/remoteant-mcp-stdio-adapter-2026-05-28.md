# remoteant MCP-stdio adapter — V1 spec

**Plan:** ant-verification-2026-05-28
**Milestone:** E1
**Author (draft):** @antiosclaude (drafted on @speedycodex behalf at JWPK push-for-100% directive)
**Status:** Draft awaiting @speedycodex ratification — DO NOT flip milestone status until owner ratifies

---

## Purpose

ANT is collaborative: terminals talk to terminals via a shared substrate, and the substrate just records what happened. **remoteant** is the bridge that lets a Mac antchat client surface terminal sessions running on a remote ANT server, AND lets local terminals participate in remote rooms. It uses **MCP stdio** so any MCP-aware CLI agent (Claude Code, Codex, Gemini CLI, aider, cursor) can interoperate with ANT rooms without server-specific code — the agent already speaks MCP; remoteant just exposes ANT room operations as MCP tools.

Critical reframe (per `feedback-ant-skills-are-tasks-not-model-calls`): **remoteant does NOT call LLMs, pick models, or construct prompts.** It transports messages between terminals and the server. Agents that connect to it via MCP do their own work using whatever LLM they have access to. The bridge is a transport, not a planner.

This spec is V1: Mac-first daemon, iOS observes status only, single user-identity per daemon. Linux/Windows daemon paths and multi-identity are V2+.

## Architecture

- **remoteant is a daemon process** (one per machine that hosts terminals).
- It speaks the **MCP protocol over stdio** so any MCP-aware CLI can attach as a client and consume `bridge.*` tools.
- It maintains a **persistent connection** (WebSocket primary, SSE fallback) to the ANT server for room-scoped events.
- It surfaces terminal sessions and room operations as MCP tools the CLI can invoke.
- It writes every dispatch + completion to an **audit log** with handle, method, params hash, result, duration, timestamp.

### What remoteant is NOT

- NOT an LLM caller. Never selects, prompts, or talks to a model API.
- NOT a substrate. The server owns rooms, messages, tasks, audit. remoteant is the wire.
- NOT a UI. Status surfaces are consumed by antchat (Mac) and antios (iOS) via the same `/api/bridge/status` endpoint.
- NOT iOS-resident. iOS observes daemon health remotely; iOS never spawns or supervises a daemon.

### Relationship to existing substrate

- The earlier `M4 Remote ANT` design (`docs/remote-ant-design-contract-2026-05-13.md`) defined **server-side bridge admissions / mappings / events** — that work stands. remoteant V1 is the **client-side daemon** that holds an `rbt_...` bearer + mapping_id (issued by the M4 redeem flow) and pumps messages across the bridge on behalf of locally-attached terminals.
- The earlier `M6.5 Local terminal bridge` design (`docs/m6-5-local-terminal-bridge-design-2026-05-14.md`) put PTY orchestration inside Tauri/Rust for the thin-client. remoteant V1 is the **standalone daemon variant** of that role — same posture (server-authoritative, audit-logged, no JS-trusted command execution), but reachable over MCP stdio so any CLI can attach, not just the Tauri webview.

## Process lifecycle

- **Spawn.** Mac antchat starts remoteant via **LaunchAgent** (preferred — survives antchat restarts cleanly, OS-supervised) or **in-process supervision** (simpler, antchat owns the process). Default V1: LaunchAgent. The `.plist` lives at `~/Library/LaunchAgents/com.antchat.remoteant.plist`; antchat writes it on first launch and `launchctl bootstrap`s it.
- **Respawn.** If remoteant exits unexpectedly, the supervisor (LaunchAgent's `KeepAlive` or antchat's child-process watcher) restarts within **5 seconds**, with **exponential backoff** capped at 60s after repeated failure. Status reports `degraded` between failure and successful restart.
- **Reap.** On antchat quit, send `SIGTERM`; remoteant flushes pending audit-log entries + closes the server connection; force-kill with `SIGKILL` after **10 seconds**. LaunchAgent setups receive `launchctl bootout` from antchat's quit handler.
- **Logging.** remoteant writes JSON-lines to `~/Library/Logs/Antchat/remoteant.log` on Mac (`%APPDATA%\Antchat\Logs\remoteant.log` future Windows). **Rotates at 10MB**, keeps last 5 rotations. Log level is INFO by default, DEBUG via `REMOTEANT_LOG_LEVEL=debug`.
- **iOS posture.** iOS does NOT spawn remoteant. iOS reads daemon health via `GET /api/bridge/status` (defined below) and renders the result through `BridgeStatusStore` + `BridgeStatusPill`. The pill stays in `unknown` state on iOS unless the server reports a daemon registered for the user's identity.

### Single-instance invariant

Only one remoteant daemon may run per `(user-identity, machine)` pair. Spawn checks `~/Library/Application Support/Antchat/remoteant.pid`: if the PID is live and the heartbeat file (`remoteant.heartbeat`, mtime within last 30s) is fresh, the new spawn exits with code 0 + log entry `another instance is healthy`. Stale PID + stale heartbeat → claim the slot, write fresh PID, continue.

## stdio JSON-RPC contract

All requests follow MCP spec: JSON-RPC 2.0, `id`, `method`, `params`. Responses are either `{ "id", "result" }` or `{ "id", "error": { "code", "message", "data" } }`. Notifications (no `id`) flow remoteant → client for server-pushed events.

### Methods exposed by remoteant

| Method | Params | Returns | Notes |
|---|---|---|---|
| `bridge.status` | none | `BridgeStatusResponse` (see below) | Cheap read — used by callers polling health. |
| `bridge.connect` | `{ serverUrl: string }` | `{ state: "connected" \| "degraded", lastConnectedAtMs }` | Establishes or re-establishes the server connection. Idempotent. |
| `bridge.send` | `{ roomId: string, message: object }` | `{ messageId: string, status: "accepted" \| "queued" }` | Routes a message to a room via the server. `queued` means the daemon is `degraded` and the message is buffered for flush on reconnect. |
| `bridge.subscribe` | `{ roomId: string }` | `{ subscriptionId: string }` | Emits room events as JSON-RPC notifications under `bridge.event` with `{ subscriptionId, event }`. |
| `bridge.unsubscribe` | `{ subscriptionId: string }` | `{ ok: true }` | Cancels a subscription. |
| `bridge.disconnect` | none | `{ ok: true }` | Graceful disconnect from the server; daemon stays running for later `bridge.connect`. |

### Notifications (daemon → client)

- `bridge.event` — `{ subscriptionId, kind, payload }` for each subscribed room event.
- `bridge.statusChanged` — `{ state, lastConnectedAtMs, pendingMessages }` whenever the daemon's status transitions.

### Error codes

| Code | Meaning |
|---|---|
| `-32001` `auth_required` | No bearer token presented. |
| `-32002` `auth_invalid` | Token rejected by server. |
| `-32003` `nonce_replay` | Nonce reuse detected; client must mint a fresh nonce. |
| `-32004` `not_connected` | Daemon is `offline`; caller should `bridge.connect` first. |
| `-32005` `room_not_authorized` | Bearer is valid but does not grant access to the requested room. |
| `-32010` `daemon_degraded` | Operation accepted but queued; will retry on reconnect. |

## Auth

- **Identity inheritance.** remoteant inherits the user's identity from the antchat session. On first spawn, antchat hands the daemon the **Keychain-backed bearer token** via stdin (one-shot, then the daemon never reads stdin for secrets again). Subsequent restarts re-fetch from Keychain via a documented Keychain access group shared by antchat + remoteant.
- **Per-process nonce.** Every request to the ANT server includes the bearer token PLUS a **per-process monotonic nonce** (`X-Antchat-Nonce: <pid>-<incrementing-uint64>`). The server tracks the (pid, nonce) high-watermark per bearer and rejects any value at-or-below the watermark with `-32003 nonce_replay`. Prevents replay if a bearer leaks to a parallel process.
- **Server-authoritative validation.** EVERY operation — `send`, `subscribe`, `connect`, `status` proxied through the server — is validated by the server: bearer ↔ identity, nonce freshness, mapping_id allows direction, room membership. The daemon is NEVER trusted to assert what a user can do.
- **Audit log entries** (recorded server-side and locally) capture the fields listed below.

## /api/bridge/status endpoint (for iOS + Mac consumption)

```typescript
type BridgeStatusResponse = {
  state: "connected" | "degraded" | "offline" | "unknown",
  serverUrl: string | null,
  lastConnectedAtMs: number | null,
  pendingMessages: number,    // queued while degraded; 0 when connected/offline/unknown
  daemonPid: number | null,   // null on iOS (no daemon)
  daemonVersion: string | null
}
```

- **GET** only. No mutating verbs on this route — daemon control happens via MCP stdio locally; this endpoint is the read-only surface.
- **Auth** via `Authorization: Bearer <user-token>`.
- **Server resolution.** The server resolves the response by:
  1. Looking up the most recent daemon-heartbeat row for the caller's identity (heartbeats POSTed by remoteant every 15s while connected).
  2. If heartbeat is fresh (< 30s) → `connected` with `daemonPid` + `daemonVersion` from the heartbeat row.
  3. If heartbeat is stale (30s–5min) → `degraded`, `pendingMessages` from the server-side outbound queue.
  4. If heartbeat absent or > 5min stale → `offline` with `daemonPid: null`, `daemonVersion: null`.
  5. iOS callers never have a daemon → always `unknown` unless the server has SEEN a daemon for this identity recently, in which case it reports that daemon's state (read-only window into the Mac daemon's health). This lets `BridgeStatusPill` on iOS reflect what's happening on the user's Mac.
- **Mac antchat's `BridgeStatusPill`** and **iOS `BridgeStatusPill`** consume the SAME shape — one source of truth, zero divergence.

### iOS-side wire-up — the 3-change TODO in `BridgeStatusStore.swift`

The iOS stub already exists at `ANT/Stores/BridgeStatusStore.swift` with a TODO block enumerating the exact three changes:

1. **Add `BridgeStatusDTO` to `ANT/Core/Network/APIClient.swift`** (near the Visibility DTOs block ~line 887). Shape:

   ```swift
   // MARK: - Bridge Status DTO (E1 — remoteant MCP-stdio adapter)
   struct BridgeStatusDTO: Decodable {
       let state: String                  // "connected" | "degraded" | "offline" | "unknown"
       let serverUrl: String?
       let lastConnectedAtMs: Int64?
       let pendingMessages: Int
       let daemonPid: Int?
       let daemonVersion: String?
   }
   ```

2. **Add `getBridgeStatus()` extension on `APIClient`** (near existing `getValidationSummary` extension ~line 966):

   ```swift
   extension APIClient {
       func getBridgeStatus() async throws -> BridgeStatusDTO {
           try await get("/api/bridge/status")
       }
   }
   ```

3. **Replace the `.unknown` stub in `BridgeStatusStore.refresh()`** with a real decode + server-authoritative state mapping. The current TODO already includes the example shape; the implementation is:

   ```swift
   func refresh() async {
       isLoading = true
       defer { isLoading = false }
       do {
           let dto = try await api.getBridgeStatus()
           state = BridgeConnectionState(rawValue: dto.state) ?? .unknown
           detailMessage = dto.serverUrl.map { "Server: \($0)" }
           lastCheckedAt = Date()
           lastError = nil
       } catch {
           state = .unknown
           detailMessage = nil
           lastCheckedAt = Date()
           lastError = String(describing: error)
       }
   }
   ```

No new files. No new views. `BridgeStatusPill` already renders all four states correctly per its preview block.

## Audit log fields

Recorded server-side on every dispatch + completion event (and mirrored to the local `remoteant.log` for operator inspection):

| Field | Type | Meaning |
|---|---|---|
| `handlerHandle` | string | Caller's `@handle` resolved server-side from bearer. |
| `method` | string | e.g. `bridge.send`, `bridge.subscribe`. |
| `targetRoomId` | string \| null | Room scope when relevant. |
| `paramsHash` | string (sha256 hex) | Digest of params object — NO raw message content here; the message itself lives in the room substrate. |
| `resultCode` | string | `ok` or one of the error codes above. |
| `durationMs` | number | Wall-clock from request receive to response send. |
| `createdAtMs` | number | Epoch ms when the event was recorded. |
| `mappingId` | string \| null | The `chat_remote_mappings.id` if this was a cross-bridge event (M4 substrate). |
| `nonce` | string | The `(pid, nonce)` value presented; useful for replay-investigation. |

Append-only. No deletes. Retention matches the server's existing audit-log policy.

## Tests required

1. **Daemon spawn → handshake → status reads `connected`.** End-to-end: antchat launches LaunchAgent, daemon registers heartbeat, server's `/api/bridge/status` returns `connected` within 5s.
2. **Server crash → `degraded` with `pendingMessages > 0` → messages flush on reconnect.** Kill the WebSocket server-side, send N messages via `bridge.send`, observe `status: queued` responses, restart server, observe flush + audit-log entries for each delayed dispatch.
3. **Auth failure → daemon stays `offline` with explicit reason.** Hand the daemon an invalid bearer; status endpoint reports `offline`, log line `auth_invalid`, no infinite reconnect storm (backoff respected).
4. **Reap on parent quit.** Quit antchat; verify daemon exits within 10s via process-table observation. LaunchAgent variant: verify `launchctl bootout` was called and the agent is unloaded.
5. **Single-instance invariant.** Spawn two remoteant processes concurrently; verify second exits with code 0 + log line `another instance is healthy` and does NOT touch the PID file.
6. **Nonce replay rejection.** Replay a captured request with the same `(pid, nonce)` value; server returns `-32003 nonce_replay`.
7. **iOS read-only window.** With a healthy Mac daemon, hit `/api/bridge/status` from iOS bearer; verify `daemonPid` + `daemonVersion` are populated and `state` matches the Mac's actual state.

## What this spec does NOT cover

- **Implementation language.** TypeScript (Node + MCP SDK) and Go are both reasonable. @speedycodex picks at implementation time. Spec is language-agnostic.
- **Wire format for room events beyond what MCP already defines.** The MCP notification envelope carries the event; the inner payload follows the existing ANT chat-room message schema.
- **Multi-user remoteant.** V1 is one user-identity per daemon. Multi-user (one daemon serving multiple Keychain identities) is V2.
- **Cross-platform Linux/Windows daemon paths.** Mac-first. Linux SystemD unit + Windows Service variants ship in a later milestone.
- **Encryption beyond TLS.** TLS to server is mandatory; per-message encryption is out of scope.
- **Rate-limiting at the daemon level.** Server already rate-limits per bearer; daemon adds no extra throttle in V1.

## Open questions for @speedycodex (consolidated for ratification)

1. **Spawn mechanism preference.** LaunchAgent .plist (cleaner, OS-supervised, survives antchat restart) vs in-process supervision (simpler, antchat owns lifetime). Spec currently defaults to LaunchAgent — confirm or override.
2. **Token caching.** Should remoteant cache the user's bearer in memory only (fetch from Keychain on every cold start), or persist a copy in its own Keychain access group (faster restart, slightly larger attack surface)? Spec currently assumes memory-only with shared Keychain access group on restart.
3. **Crash-recovery policy for pendingMessages.** On reconnect after a daemon crash, replay buffered messages (current spec default) OR surface them as "lost — ask the user to retry"? Replay matches the `queued` semantics already promised to callers; lost-and-ask is safer if buffered messages might be stale.
4. **Version negotiation.** Hardcode V1 (current spec — clients expect `bridge.*` methods), OR include a `bridge.handshake { clientProtocolVersion }` method that picks a mutually-supported protocol version at connect time (future-proofs cleanly, costs one extra round-trip)?

## Cross-references

- **E2 — antchat-Mac lifecycle integration** (@homebrewclaude). Consumes the spawn/reap/respawn contract above. The LaunchAgent .plist authoring + child-process supervisor live in antchat.
- **E3 — iOS bridge consumption** (already shipped as stub by @antiosclaude). The three-change wire-up in `BridgeStatusStore.swift` is enumerated above. No view changes; pill already renders all four states.
- **Earlier session decision** (eiw05zdurz msg_4o5528hf3z onward): bridge=C green-lit by JWPK; remoteant becomes a new daemon with MCP-stdio adapter (this spec).
- **M4 Remote ANT design contract** (`docs/remote-ant-design-contract-2026-05-13.md`): the server-side bridge substrate (`chat_remote_admissions` / `chat_remote_mappings` / `chat_remote_events`) that remoteant V1 holds tokens for.
- **M6.5 Local terminal bridge design** (`docs/m6-5-local-terminal-bridge-design-2026-05-14.md`): the Tauri/Rust posture (server-authoritative, no JS-trusted command execution) that V1 inherits and generalises to a standalone daemon.
- **Feedback memory** (`feedback-ant-skills-are-tasks-not-model-calls`): the bridge transports messages; it does NOT call LLMs, pick models, or build prompts. Every section of this spec respects PULL-not-PUSH semantics.

---

*Draft ends. @speedycodex to ratify (or amend) before E1 milestone flips to PASS.*
