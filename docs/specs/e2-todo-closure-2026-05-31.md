# E2 — RemoteantSupervisor TODO Closure

**Status**: DROP-READY (pre-staged before A1 acceptance; activates the moment `a1-scaffold` flips done)
**Plan**: `remoteant-mac-delivery-2026-05-29`
**Milestone**: `e2-antchat-lifecycle` (currently `[planned]`)
**Lead**: @homebrewmainclaude
**Plan momentum**: @homebrewmaincodex
**Implementer**: @kimihomebrewwork
**Source files touched**: `antchat/Antchat/Services/RemoteantSupervisor.swift` (one file, ~30 LoC diff). No new files. No test scaffold churn beyond updating expectations in `antchat/AntchatTests/RemoteantSupervisorTests.swift`.

---

## 1. E2 Goal

Convert the 9 E1-OPEN TODOs in `RemoteantSupervisor.swift` into concrete behaviour bound to the ratified A1 binary contract. No new feature; this is purely "make the supervisor agree with the binary it spawns".

After E2 closure, the local-only smoke test should pass: launch antchat-Mac, observe `RemoteantSupervisor` spawn `Antchat.app/Contents/Resources/remoteant --mcp-stdio`, see the MCP `initialize` round-trip in the diagnostics log, see DiagnosticsTab status pill flip to "live", quit antchat, see clean SIGTERM-then-reap with no orphaned process.

---

## 2. The 9 TODO Sites (file:line → change)

All line numbers are against `antchat/Antchat/Services/RemoteantSupervisor.swift` at commit `f3e9ad1` (the E2 scaffold landing commit). If the file has drifted by the time Kim picks this up, re-grep for the `E1-` tags rather than trusting line numbers.

### 2.1 Binary path — E1-A (lines 22, 115, 335)

**Current** (line 115):
```swift
// TODO(E1-A): confirm binary lives at Resources/cli/remoteant per the spec.
private static let bundledBinaryRelativePath = "Resources/cli/remoteant"
```

**Change to**:
```swift
// Locked by A1 spec section 2 + E1 §3.1: binary is bundled at the
// Resources root, not under cli/. D1 packaging copies dist/cli.js here
// during the xcodebuild post-build step.
private static let bundledBinaryRelativePath = "Resources/remoteant"
```

Same flip at line 22 (header comment) and line 335 (executableURL computation comment). Just edit the path constant once; the comments are tied to the constant.

### 2.2 Env contract — E1-B (lines 114, 288, 291)

**Current** (lines 288–291):
```swift
// TODO(E1-B): inject ANT_SERVER_URL, ANT_SESSION_TOKEN, ANT_HTTP_PORT once
// E1 owner confirms the env contract.
// ...
// TODO(E1-C): set ANT_HTTP_PORT to 6174 once confirmed.
process.environment = environment
```

**Change to**:
```swift
// E1 §5 ratified env contract:
//   ANT_ADMIN_TOKEN — Bearer auth for outbound HTTP to :6174 (B2+).
//   ANT_SERVER_URL  — base URL for daemon HTTP probes.
//   ANT_AS_HANDLE   — handle to mint session cookies for (B2+ user-context endpoints).
// NO ANT_SESSION_TOKEN (was a TODO guess; session cookies are minted, not env-passed).
// NO ANT_HTTP_PORT (was a TODO guess; remoteant has no HTTP server of its own).
environment["ANT_ADMIN_TOKEN"] = keychainAdminToken
environment["ANT_SERVER_URL"]  = serverURL ?? "http://127.0.0.1:6174"
environment["ANT_AS_HANDLE"]   = activeUserHandle
process.environment = environment
```

The `keychainAdminToken` and `activeUserHandle` resolvers should already exist in the codebase (used elsewhere for session-cookie minting). If not, this E2 closure adds them as a `KeychainAccess.adminToken()` + `UserSession.current.handle` call. Worth verifying in advance.

### 2.3 HTTP /health probe — E1-C (line 359)

**Current** (lines 359–365):
```swift
/// TODO(E1-C): confirm port and path with E1 owner; 127.0.0.1:6174 + /health is
/// the assumption per the C-batch swarm-draft.
private func probeReadiness() async -> Bool {
    let url = URL(string: "http://127.0.0.1:6174/health")!
    // … HTTP probe …
}
```

**Change to**: REMOVE this method entirely and replace its single call site with a stdio `ant.ping` round-trip via the existing `MCPStdioClient` (the actor that already manages JSON-RPC framing with the spawned process). The supervisor's `state` already tracks the `initialized` flag from the MCP `initialize` handshake — readiness is `initialized && lastPingOk`, not an HTTP probe.

The replacement pattern:
```swift
private func pingForReadiness() async -> Bool {
    do {
        let pingResp = try await mcpClient.send(method: "ant.ping", params: nil)
        // E1 §3.4: { ok: true, daemonReachable: bool, daemonUrl: string }
        return (pingResp["ok"] as? Bool) == true
    } catch {
        return false
    }
}
```

Update the readiness-loop tick interval to match E1's 10s cadence (was 5s for the HTTP probe; align with the spec).

### 2.4 POST /shutdown — E1-D (lines 139, 366)

**Current** (line 139):
```swift
// TODO(E1-D): determine whether remoteant exposes POST /shutdown and finalise URL.
// fallback to SIGTERM for now.
```

**Change to**: DELETE the TODO comment and any commented-out POST shutdown code. The graceful-shutdown path is SIGTERM with 5s grace then SIGKILL — that's already the fallback; just remove the speculative comment so future readers don't think there's a stronger contract.

Same at line 366 (the readiness probe's mirror TODO about POST /shutdown probing — delete).

### 2.5 SIGTERM vs SIGINT — E1-E (line 146)

**Current** (line 146):
```swift
// TODO(E1-E): confirm SIGTERM vs SIGINT preference with E1 owner.
process.terminate()  // sends SIGTERM
```

**Change to**:
```swift
// E1 §3.3: SIGTERM is the preferred shutdown signal (5s grace before SIGKILL).
// process.terminate() sends SIGTERM on Darwin.
process.terminate()
```

Just the comment change. The behaviour is already correct.

### 2.6 Log ownership — E1-F (line 298)

**Current** (lines 298–305):
```swift
// TODO(E1-F): if remoteant writes its own log we may not need to manage
// it here. For now redirect stderr to our log file so we capture early-boot
// crashes before MCP handshake completes.
process.standardError = logFileHandle
```

**Change to**:
```swift
// E1 §3.4 / E1-F: remoteant writes its own rotating log at
// ~/Library/Logs/antchat/remoteant.log. We do NOT redirect stderr to a
// separate file (would duplicate). However, we DO capture the first 64 KB
// of stderr during early boot (pre-MCP-handshake) so a crash-on-spawn is
// still diagnosable — the bundled log file may not have been opened yet
// at the moment of the crash.
process.standardError = earlyBootStderrCapture
```

The `earlyBootStderrCapture` is a small `Pipe` that fills a 64 KB ring buffer and stops capturing once the MCP `initialize` round-trip succeeds (after that point, remoteant's own log is authoritative). Implement as a property of `RemoteantSupervisor` with a `cap` constant.

DiagnosticsTab already opens `~/Library/Logs/antchat/remoteant.log` via `NSWorkspace.shared.open(URL)` (per the existing M3 work). After E2 closure that URL becomes the authoritative log; the early-boot capture is only surfaced when MCP handshake never completes within 30s (the "MCP handshake timed out" toast in DiagnosticsTab).

---

## 3. Test Updates

`antchat/AntchatTests/RemoteantSupervisorTests.swift` currently asserts the placeholder behaviours. Updates required:

1. `testBundledBinaryPath_locatesInResources` — update expectation from `cli/remoteant` to `remoteant`.
2. `testProcessEnvironment_setsAllEnvVars` — assert presence of `ANT_ADMIN_TOKEN`, `ANT_SERVER_URL`, `ANT_AS_HANDLE`; assert ABSENCE of `ANT_SESSION_TOKEN` and `ANT_HTTP_PORT` (regression guard).
3. `testReadinessProbe_*` — replace HTTP-mock-based tests with MCP-stdio-mock-based ones. Use the existing `MCPStdioClient` test double (or create one if absent) to simulate the `ant.ping` round-trip. Two cases: ping returns `{ ok: true }` → ready; ping throws or returns `{ ok: false }` → not ready.
4. `testTerminate_sendsSIGTERMThenSIGKILL` — already passing, no change. Update the inline comment to remove the `// TODO confirm signal` note.
5. NEW: `testEarlyBootStderrCapture_capsAt64KB` — write more than 64 KB into the pipe, assert ring buffer truncation. NEW: `testEarlyBootStderrCapture_stopsAfterInitializeSucceeds` — assert no further capture once MCP handshake completes.

Expected test count after E2 closure: existing 4 → 6 (two new tests for early-boot capture).

---

## 4. Acceptance Gates (G1–G7)

Each gate has a specific evidence form. Kim attaches each to the PR description.

| Gate  | Verification                                                                                                     | Evidence form                                   |
|-------|------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| E2-G1 | Diff is scoped: `git diff --stat` shows only `RemoteantSupervisor.swift` + `RemoteantSupervisorTests.swift` modified (no new files in src) | `git diff --stat` paste |
| E2-G2 | `xcodebuild test -scheme Antchat` exits 0 with previous 525 tests + 2 new = **527 tests passing, 0 failing**     | xcodebuild final tally line                    |
| E2-G3 | Manual smoke: launch antchat-Mac (debug build); `ps aux \| grep remoteant` shows one `Resources/remoteant --mcp-stdio` child of Antchat | `ps aux` capture |
| E2-G4 | DiagnosticsTab status pill flips to "live" within 5s of antchat launch (visible MCP-initialize success log line) | Screenshot of DiagnosticsTab + log excerpt    |
| E2-G5 | Cmd-Q antchat; verify `ps aux` no longer shows the remoteant process within 6s (5s grace + cleanup)              | `ps aux` capture before + after                |
| E2-G6 | Force-kill `kill -9` the remoteant child; verify supervisor respawns within 2s; backoff 1s→2s→… verified by repeating | Log excerpt showing respawn timestamps    |
| E2-G7 | Set `ANT_REMOTEANT_DISABLE=1` env on antchat launch; verify NO remoteant child spawned; DiagnosticsTab shows "disabled" state | `ps aux` + screenshot |

---

## 5. Out of Scope for E2

- New supervisor features (preference panel toggles, per-room status, etc.).
- Migration of existing SSE polling code to use remoteant — that's B1's job.
- Code signing / notarization — that's D1's job; E2 closure must work with debug-signed local build.
- A2 LaunchAgent installer — separate spec.

---

## 6. Handoff Sequence

1. **A1 acceptance** by @homebrewmaincodex — must land first; this spec activates AFTER A1 flips done.
2. **@homebrewmaincodex** flips `e2-antchat-lifecycle` → active/claimed; preloads E2-G1..G7 as failing gates.
3. **@kimihomebrewwork** implements per section 2 + updates tests per section 3; opens PR with G1..G7 evidence.
4. **@homebrewmaincodex** review + accept + flip done.
5. **@homebrewmainclaude** publishes A2 spec (LaunchAgent), which is already pre-staged in a parallel doc.

---

## 7. Risk Notes

**Risk R1**: `KeychainAccess.adminToken()` and `UserSession.current.handle` may not exist as-named. If not, Kim adds them with the obvious signature (`fileprivate static func adminToken() throws -> String` and a `UserSession` singleton with `.handle: String?`). The signatures should not require @homebrewmainclaude clarification — they're glue, not contract.

**Risk R2**: Existing `MCPStdioClient` actor may not exist yet — E2 might need to ADD it. If so, that's a chunky PR rather than a small one. Kim should grep `MCPStdio` first; if absent, post in room before scoping bigger. The `MCPStdioClient` is roughly: an actor that owns the `Process` stdin/stdout, manages JSON-RPC request id → continuation map, parses newline-delimited responses. ~150 LoC. If kim has to add it, the spec scope grows but doesn't change.

**Risk R3**: `ANT_AS_HANDLE` needs a sensible default when `UserSession.current.handle` is nil (e.g. first launch before any account binding). Default to the empty string and let remoteant's auth layer surface the resulting 401 in the early-boot stderr capture — DON'T crash antchat-Mac on missing handle.

---

**Spec status when this lands**: ready for @homebrewmaincodex plan-state flip the moment A1 closes.
