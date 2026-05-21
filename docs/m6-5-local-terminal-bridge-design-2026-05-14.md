# M6.5 — Local terminal bridge — design contract

Date: 2026-05-14
Author: @researchant (research-only scout, no code changes)
Status: DESIGN-FIRST. No m6.5 implementation claim until canonical PASS.
Cap: ≤180L.

## TL;DR (delta-2: B1 stale-doc scrub for B2 origin lock)

The Tauri thin-client (m6.4) gains a controlled native-side PTY surface
managed RUST-INTERNALLY (per Q4 B2 origin lock — remote-ANT webview is
NOT trusted to invoke native command execution). PTY orchestration
runs in a Rust polling task (Q5) that POSTs stdout to existing
chat-room messages routes + receives terminal_input via the same
surface. NO Tauri-invoke commands exposed to JS. Reuses existing ANT
API contracts (no new routes).

T1 SCOPE (current slice): NEW pty.rs PtyRegistry + allowlist.rs +
Tauri capability config + plugin registrations + cargo check + unit
tests. Compile-proof + structural foundation only.
T2 SCOPE (next slice): consent prompt wiring + tauri::State managed
registry + Rust polling task implementation.

## Q1 — PTY library choice

Rust ecosystem has two well-trodden options:
- **`portable-pty`** (wez/wezterm) — most popular, MIT, cross-platform
  (Unix + Windows ConPTY), production-tested in WezTerm.
- **`pty-process`** (smaller crate, Unix-only).

**Default proposal**: `portable-pty`. Cross-platform from day one,
matches Phase 6 macOS+Windows-first framing. Rust bindings stable for
years. Wraps Unix forkpty + Windows ConPTY uniformly.

## Q2 — Internal PTY surface (delta-1: NOT JS-invoke per B2 lock)

PTY operations are RUST-INTERNAL functions in src-tauri/src/pty.rs,
called by the Rust polling task (Q5) — NOT exposed as Tauri-invoke
commands to the webview (per B2 lock). Public surface to JS is empty.
Internal Rust API:
- `spawn(cwd, cmd, args) -> Result<PtyHandle>` after operator consent
  prompt + allowlist + CWD check.
- `write(handle, data) -> Result<()>`, `resize(handle, cols, rows)`,
  `kill(handle)`, `list() -> Vec<PtyHandleInfo>` — all Rust-only.
- AppState owns `HashMap<HandleId, PtyMaster>`; thread-safe via Mutex.

## Q3 — Stdout streaming (delta-1: Rust → ANT route, no JS events)

PTY stdout is byte-oriented. Per B2 lock, no JS event emit (JS never sees
raw PTY bytes). Rust task per PTY:
- Reads from PtyMaster into a bounded mpsc channel (1024B buffer; slow
  drops oldest + logs overflow).
- POSTs accumulated chunks to /api/chat-rooms/:roomId/messages with
  author = the registered terminal handle. Existing chat-room infrastructure
  handles fan-out to consumers (the webview gets bytes via standard
  message polling, just like any other agent's output).

## Q4 — Security boundary (delta-1 B2 lock)

A native PTY is a sharp tool. **THREE binding locks**:

- **B2 ORIGIN GATING (canonical 2026-05-14)**: m6.3 thin-client loads a
  REMOTE ANT URL in the Tauri webview. Remote page content MUST NOT be
  able to invoke pty_spawn. Tauri 2.x capabilities config
  (src-tauri/capabilities/*.json) restricts pty_* commands to LOCAL
  origins only — the webview running operator-supplied remote content
  is explicitly DENIED. PTY orchestration runs in a Rust-side polling
  task (see Q5 revision), NOT JS-triggered from the remote page.
- **OPERATOR CONSENT PROMPT**: every pty_spawn invocation triggers a
  native dialog (tauri-plugin-dialog) requiring explicit operator click
  before the process starts. Blocks silent spawn even from local origins.
- **Operator allowlist + CWD escape rejection**: cmd must match
  configured allowlist (`["bash", "zsh", "fish", "claude", "codex",
  "cursor", "gemini", "aider"]` default; persisted in stronghold). cwd
  must canonicalize inside HOME — reject ../ and absolute paths outside.

Per [[feedback_ant_chat_strips_redirects]] the chat-strip discipline
applies. The B2 lock generalises this: never trust webview content for
native command execution, regardless of how it arrived.

## Q5 — ANT API mapping (delta-1: B1 route fix + B2 architectural shift)

The bridge does NOT introduce new ANT API surface. PTY orchestration
runs SERVER-SIDE in a Rust polling task per Q4 B2 lock (no JS-triggered
invoke from the remote-ANT webview).

ARCHITECTURE:
- Rust task at app startup: poll the configured remote ANT server URL
  (from stronghold) for messages addressed to the local terminal IDs;
  on terminal_input messages, prompt operator consent + write to
  matching local PTY (no JS layer involved in the trigger path).
- Terminal registration: Rust-side POST /api/identity/register on app
  start with agent_kind from M3.2a fingerprintDetector logic; receive
  terminal_id back; persist to stronghold.
- PTY stdout → Rust-side POST /api/chat-rooms/:roomId/messages with
  author = registered terminal handle (existing chat-room-message
  route — verified on disk via `ls src/routes/api/chat-rooms/[roomId]/
  messages/`).
- The remote-ANT webview consumes chat-room messages normally; native
  PTY work is orchestrated by Rust without trusting webview JS.

Reuses pidChain identity model from M3.2a/M3.2c. NO new API routes.

## Touch points (for m6.5 implementer)

T1 (this slice — compile-proof):
- EDIT src-tauri/Cargo.toml: add `portable-pty = "0.8"` + `tauri-plugin-dialog`.
- NEW src-tauri/src/pty.rs ≤200L: PtyRegistry struct + Rust-internal
  spawn/write/resize/kill/list (NO #[tauri::command]).
- NEW src-tauri/src/allowlist.rs ≤40L: cmd + cwd validation.
- EDIT src-tauri/src/lib.rs: register modules + plugin + Arc<PtyRegistry>.
- NEW src-tauri/capabilities/local-only.json: capability config.

T2 (next slice — wiring):
- Wire registry as tauri::State managed state.
- Add operator consent prompt (tauri-plugin-dialog) before each spawn.
- Implement Rust polling task via tauri::async_runtime::spawn that
  polls remote ANT chat-room messages + dispatches to pty.write.
- README addition: how to configure allowlist.

## Locked acceptance (3-slice partial-framing)

T1 acceptance (PASSED 2026-05-14, compile-proof):
- portable-pty + tauri-plugin-dialog compiles via `cargo check`.
- pty.rs PtyRegistry + Rust-internal API + allowlist.rs (unit tests).
- src-tauri/capabilities/local-only.json present.
- bun run code-qa stays green.

T2a acceptance (PASSED, managed-state + parser):
- lib.rs `.manage(Arc<PtyRegistry>)` + tauri::async_runtime::spawn polling
  task. poller.rs PollerConfig + run_polling_loop + parse_terminal_input
  + tests. fetch_messages stub returns None.

T2b acceptance (PASSED, reqwest + consent module + env-var config):
- reqwest::Client + bearer_auth + NEW consent.rs spawn_with_consent
  (DEFINED, call-site wiring → T2c). PollerConfig loads env vars.

T2c acceptance (THIS slice, parser + dispatch + consent-call wired):
- NEW parse_spawn_request parser + 4 unit tests.
- Polling loop dispatches spawn_request → consent::spawn_with_consent
  (real call-site per B2 lock); fallthrough → terminal_input → write.
- run_polling_loop signature accepts AppHandle.

T2d acceptance (NEXT slice, stronghold-config + live proof):
- Replace env-var PollerConfig with stronghold-Rust-side read of the
  m6.4 wizard records (serverUrl + bridgeToken). iota_stronghold API
  research — likely separate research-doc before impl.
- Integration test (mock dialog) OR live :6461 dispatch proof.

## Do-not-use

| Rejected | Why |
|---|---|
| node-pty (npm) inside Tauri webview | Webview is JS-only; native bindings won't load. |
| Spawn arbitrary `cmd` from any string input | Allowlist is non-negotiable security boundary. |
| #[tauri::command] for pty_* | B2 origin-gating lock — Rust-internal only. |
| Add new /api/pty-bridge route | Reuse existing /api/chat-rooms routes per JWPK no-fork. |
| pty-process (Unix-only) | Phase 6 needs cross-platform; portable-pty handles ConPTY. |

## Open questions for JWPK

1. Allowlist seed: ship with `{bash, zsh, fish, claude, codex, cursor,
   gemini, aider}` defaults vs empty? Default: shipped (M3.2a kind enum +
   common shells).
2. Operator consent prompt frequency: every spawn vs first-time-per-cmd
   "remember this answer"? Default: every spawn for v1; remember-this in
   T2-followup if UX friction shows.

## What I did NOT verify

- Did NOT prototype any Rust PTY code; design only.
- Did NOT measure portable-pty stdout latency; assume <50ms p95 from
  WezTerm production usage.
- Did NOT survey Windows ConPTY edge cases beyond the portable-pty
  abstraction; trust the crate.

## Next step

Awaiting canonical RQO PASS + JWPK ACK on Q1-Q5 defaults. Implementer
claim-first proceeds under Locked Acceptance once both land.
