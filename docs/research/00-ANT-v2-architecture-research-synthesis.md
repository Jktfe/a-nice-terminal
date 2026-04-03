# ANT v2 Architecture Research Synthesis

> Research conducted April 2026. Five parallel research agents explored session capture, modern terminals, terminal I/O, CLI architecture, and competitive landscape.
> Raw findings in companion files `01-05` in this directory.

---

## Executive Summary

ANT's core architecture (node-pty + xterm.js + Socket.IO + SQLite) is fundamentally sound, but the **transport and interface layers are over-engineered** for what they do. The biggest wins come from:

1. **Stick with xterm.js** — ghostty-web is a POC with critical blockers; monitor xterm.js adopting libghostty instead
2. **Adopt OSC 133 shell integration injection** — transforms command detection from heuristic to precise
3. **Restructure around a CLI-first daemon model** — eliminate the HTTP/MCP indirection layers
4. **Add block-based command output** — the UX pattern users now expect from Warp/Wave

These are not incremental improvements — this is a genuine architectural upgrade that would make ANT the best tool in its category.

---

## 1. Rendering Layer: ghostty-web

### The Finding

**[ghostty-web](https://github.com/coder/ghostty-web)** by Coder is a drop-in xterm.js replacement that uses Ghostty's VT parser compiled to WebAssembly.

| | xterm.js (current) | ghostty-web |
|---|---|---|
| License | MIT | MIT |
| Size | ~200KB JS | ~400KB WASM |
| VT compliance | Good | Better (RTL, complex scripts, XTPUSHSGR) |
| API | `Terminal`, `open()`, `write()`, `onData()` | Same API — compatible |
| Renderer | WebGL addon | Canvas (WASM-powered) |
| Used by | VS Code, ANT | Coder's Mux (parallel agentic dev) |
| Dependencies | Multiple addons needed | Zero runtime deps |

### Addon Compatibility (Tested)

| ANT Addon | ghostty-web Status |
|---|---|
| `@xterm/addon-fit` | Built-in equivalent (`ghostty-web/addons/fit`) |
| `@xterm/addon-webgl` | Not needed — Canvas rendering, eliminates WebGL context limits |
| `@xterm/addon-unicode11` | Built-in (Unicode 15.1 via Ghostty's native impl) |
| `@xterm/addon-web-links` | Built-in (`OSC8LinkProvider` + `UrlRegexProvider`) |
| **`@xterm/addon-serialize`** | **NOT AVAILABLE — BLOCKER** |
| **`@xterm/headless`** | **NOT AVAILABLE — BLOCKER** |

### Critical Blockers

1. **No headless mode** — ghostty-web requires DOM (`open(HTMLElement)`). ANT's `HeadlessTerminalWrapper` runs `@xterm/headless` server-side for terminal state. No equivalent exists.
2. **No serialize** — no way to capture full terminal state (scrollback + screen + cursor + ANSI attributes). Only plain text extraction via Buffer API.
3. **No parser hooks** — no `registerOscHandler()` or equivalent. The WASM parser is not extensible from JavaScript. ANT registers handlers for OSC 7, 133, 1337.
4. **Self-described "proof of concept"** — primary developer describes it as POC. ~1.9k GitHub stars, 22 open issues, one main contributor.

### Verdict: Split Architecture (Not Drop-In)

**ghostty-web is NOT a drop-in replacement** for ANT's full xterm.js stack. The recommended approach is a split:

```
Browser (TerminalViewV2.tsx):  ghostty-web (when stable) — rendering only
Server (headless-terminal.ts): Keep @xterm/headless + serialize — no alternative exists
```

This captures VT compliance benefits for display while keeping the proven headless stack. For OSC parsing, intercept raw PTY data before it reaches ghostty-web.

### What to Watch

- ghostty-web adding headless/Node.js mode
- ghostty-web exposing parser hook API
- libghostty sub-libraries maturing beyond VT parser
- xterm.js potentially adopting libghostty ([issue #5686](https://github.com/xtermjs/xterm.js/issues/5686))

**See `08-ghostty-web-addon-compatibility.md` for full analysis.**

---

## 2. Shell Integration & State Detection

### The Gold Standard: OSC 133

The modern terminal ecosystem has converged on OSC 133 (FinalTerm protocol) for command boundary detection:

| Sequence | Meaning | When Emitted |
|---|---|---|
| `OSC 133;A ST` | Prompt start | Before shell prints prompt |
| `OSC 133;B ST` | Prompt end / input start | After prompt, before user types |
| `OSC 133;C ST` | Command execution start | After user presses Enter |
| `OSC 133;D;exit_code ST` | Command finished | After command completes |

**ANT's CommandTracker already implements this** — good positioning. But the key gap is: ANT doesn't *inject* the shell integration scripts that emit these sequences.

### How Modern Terminals Inject Shell Integration

Ghostty, Kitty, WezTerm, and iTerm2 all inject shell-specific scripts at session startup:

- **bash**: Set `ENV` variable pointing to integration script, add `--posix`
- **zsh**: Override `ZDOTDIR` to a directory containing a `.zshrc` that sources the integration then the user's real `.zshrc`
- **fish**: Prepend to `XDG_DATA_DIRS`

This is transparent to the user — no dotfile modifications required.

### What ANT Should Do

1. **Inject shell integration on session creation** — detect shell type, set env vars before spawning PTY
2. **Register OSC handlers in the terminal** — `parser.registerOscHandler()` for 7, 133, 633, 1337
3. **Build a state machine**: IDLE → PROMPT (on A) → COMMAND_INPUT (on B) → EXECUTING (on C) → back to IDLE (on D)
4. **Dual-path detection**: Use OSC 133 when available, fall back to `tcgetpgrp()` + `/proc` polling when not

### Input Detection (When Terminal Wants User Input)

Combine multiple signals:

| Signal | Detects | Reliability |
|--------|---------|-------------|
| OSC 133 state machine | Shell idle vs command running | High (requires shell integration) |
| `tcgetpgrp()` / `/proc/PID/stat` field 8 | Foreground process identity | High (works without shell integration) |
| termios flags (ICANON/ECHO) | Password prompts, raw mode, line input | High for input type |
| PTY output rate | Active output vs silence | Medium (heuristic) |
| Pattern matching | sudo prompts, y/n, SSH confirmations | Low (fragile, locale-dependent) |

### Additional Metadata to Capture

Beyond what ANT already tracks, consider: **hostname** (via OSC 1337 RemoteHost), **shell type**, **git branch** (if in a git repo), **terminal dimensions at execution time**.

---

## 3. Architecture: CLI-First Daemon Model

### The Problem

ANT currently has **5 hops** for AI agent interaction:
```
AI Agent → MCP Server (stdio) → HTTP REST → Express → Socket.IO → node-pty → dtach
```

The CLI also goes through HTTP:
```
ant CLI → HTTP REST → Express → Socket.IO → node-pty → dtach
```

### CLI vs MCP: A Nuanced Picture

Anthropic's internal benchmarks (early 2025) found CLI tool calls achieved ~100% reliability compared to ~72% for equivalent MCP-based operations. However, this was conducted when MCP server implementations were still maturing, and no independent replication exists. Key context:

- **The 72% figure** aggregated across early MCP server implementations. MCP has since evolved significantly (Streamable HTTP transport, OAuth auth, tool pagination).
- **The ~55,000 token schema** refers specifically to the GitHub MCP server's full `tools/list` response — a worst case for a maximally broad server. Well-designed MCP servers can curate smaller surfaces.
- **CLI's advantage is real but bounded**: it works best for tasks where mature command-line tools already exist (git, grep, find). LLMs know these from training data. MCP's value is in extensibility to services without CLIs.
- **They are complementary, not competing**: Claude Code itself supports both — CLI tools for core operations, MCP as an extension mechanism. Cursor, Windsurf, and JetBrains have all adopted MCP. It is not being deprecated.

**For ANT specifically**: terminal session management is a perfect CLI use case — the commands are well-defined, the model knows shell patterns, and structured JSON output covers the agent case. MCP should remain as an optional extension point, not the primary interface.

### Proposed Architecture

```
                     ┌─────────────────────────────┐
                     │     antd (daemon)            │
                     │                              │
                     │  ┌────────┐  ┌────────────┐  │
                     │  │ PTY    │  │ Session     │  │
                     │  │ Manager│  │ State (SQL) │  │
                     │  └───┬────┘  └─────┬──────┘  │
                     │      │             │         │
                     │  ┌───┴─────────────┴───┐    │
                     │  │  Unix Domain Socket  │    │
                     │  │  $XDG_RUNTIME_DIR/ant/antd.sock  │    │
                     │  └──────────┬───────────┘    │
                     │             │                │
                     │  ┌──────────┴───────────┐    │
                     │  │  HTTP/WS (optional)   │    │
                     │  │  for web UI / remote  │    │
                     │  └──────────────────────┘    │
                     └─────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
     ┌────────┴────────┐  ┌───────┴────────┐   ┌───────┴──────┐
     │  ant CLI         │  │  Web UI         │   │  AI Agent    │
     │  (UDS direct)    │  │  (HTTP/WS)      │   │  (Bash tool  │
     │                  │  │                  │   │   → ant CLI) │
     │  ant ls          │  │  browser app     │   │              │
     │  ant attach foo  │  │                  │   │  ant exec    │
     │  ant exec cmd    │  │                  │   │  ant screen  │
     └─────────────────┘  └──────────────────┘   └──────────────┘
```

**Result: 2 hops instead of 5**
```
AI Agent → Bash tool → ant CLI → UDS → antd → dtach
```

### Key Design Principles

1. **Unix domain socket** for local IPC (~5-10us latency vs ~1-5ms for HTTP)
2. **Newline-delimited JSON** over UDS (human-readable, debuggable, versionable)
3. **Daemon auto-start** on first CLI invocation (like tmux)
4. **Every command supports `--json`** for machine output
5. **Exit codes are semantic** (0=success, 1=error, 2=not found)
6. **Idempotent operations** (`ant session ensure <name>` creates-or-returns)
7. **MCP becomes optional** — thin wrapper that just calls `ant` CLI, or dropped entirely

### The Two Primitives AI Agents Need

```bash
# Execute a command and get structured output
ant exec <session> <cmd> --json
# → {"output": "...", "exitCode": 0, "durationMs": 1234}

# Get current terminal screen state  
ant screen <session> --json
# → {"lines": [...], "cursorRow": 5, "cursorCol": 12}
```

These work identically whether called by a human or by Claude Code's Bash tool.

### What ANT Already Has Right

- **dtach** for session persistence — keep this
- **SQLite WAL** for state — keep this
- **HeadlessTerminalWrapper** — mirrors VS Code's proven Pty Host pattern
- **CommandTracker with OSC 133** — already parsing the right protocol
- **node-pty** — remains the right PTY library for Node.js (track `@replit/ruspty` as future alternative to eliminate node-gyp)

---

## 4. Block-Based Command Output

### What Users Now Expect

Warp popularized treating each command+output as a discrete "block" — independently selectable, searchable, copyable, and usable as AI context. Wave Terminal has a similar model.

### How to Implement Without Warp's Code

ANT already has the building blocks:
1. **OSC 133 C/D markers** detect command start/end (CommandTracker already does this)
2. **Extend the existing `command_events` table** (already in `db.ts` line 200) — it already has `command`, `exit_code`, `output`, `started_at`, `completed_at`, `duration_ms`, `cwd`, `detection_method`. Just add:

```sql
ALTER TABLE command_events ADD COLUMN output_text TEXT;    -- stripped text for FTS
ALTER TABLE command_events ADD COLUMN start_chunk INTEGER; -- FK to terminal_output_events
ALTER TABLE command_events ADD COLUMN end_chunk INTEGER;   -- FK to terminal_output_events
```

3. **Add an FTS5 external content table** to index without duplicating string content (important for large terminal buffers):

```sql
CREATE VIRTUAL TABLE command_events_fts USING fts5(
  command, output_text,
  content='command_events',
  content_rowid='rowid'
);
```
4. **Render blocks in the web UI** with visual boundaries, exit code indicators, and copy/share actions

### Session Recording

Consider adopting **asciicast v3** format (from asciinema 3.0, September 2025) for session export/replay:
- Newline-delimited JSON with delta timestamps
- Event types: `o` (output), `i` (input), `m` (marker), `r` (resize), `x` (exit)
- Compressible to ~15% with zstd
- Compatible with the asciinema player for web-based replay

---

## 5. Competitive Positioning

### ANT's Unique Niche

No competitor does what ANT does — **a web-based platform combining terminal sessions with conversation/messaging for AI agents**.

| Tool | Terminal Management | Web UI | AI Integration | Conversation/Messaging |
|------|-------------------|--------|----------------|----------------------|
| **ANT** | Yes (PTY + dtach) | Yes | Yes (MCP) | Yes |
| Claude Code | No (shells out) | No | Native | No |
| Cursor/Zed | Embedded (IDE) | No | Native | No |
| Warp | Native terminal | No | Agent Mode | No |
| Wave | Native terminal | No | Multi-model | No |
| Zellij | Multiplexer | No (new web client) | No | No |
| OpenClaw | No | Yes | Multi-channel | Yes |
| DevContainers | Vanilla PTY/SSH | Via IDE | No | No |

**The closest conceptual competitor** would be merging Warp's terminal UX with OpenClaw's multi-channel agent gateway — which is essentially what ANT is building.

### Gap ANT Could Fill

No one has defined a protocol for AI agents to interact with terminal sessions. MCP provides tool calling, but there's no standard for "observe terminal state, inject commands, read output, approve actions." ANT could define this.

### What Makes "Vibe Coded" Tools Feel Smooth

1. **Synchronized output** — `DCS = 1 s ST` / `DCS = 2 s ST` brackets prevent flicker (used by Claude Code's NO_FLICKER mode)
2. **Block-based output** — each command is visually discrete
3. **Always-available input** — input field never blocks, users can queue messages
4. **Instant startup** — CLI tools that auto-start daemons feel native

---

## 6. Recommendations Summary

### Tier 1: High Impact, Do First

| Change | Effort | Impact |
|--------|--------|--------|
| Inject shell integration scripts on session creation | Medium | Transforms command detection from heuristic to precise |
| Extend `command_events` table + FTS5 external content | Medium | Enables Warp-like searchable command history |
| Restructure CLI to use UDS instead of HTTP | Medium | Eliminates 3 hops, feels native |
| Add daemon auto-start (`antd`) | Low | tmux-like UX |

### Tier 2: Major Upgrades

| Change | Effort | Impact |
|--------|--------|--------|
| Monitor xterm.js adopting libghostty (issue #5686) | None (wait) | Would get VT improvements without switching libraries |
| Block-based rendering in web UI | High | Modern UX expectation |
| Add synchronized output (DCS) | Low | Eliminates flicker |
| MCP → thin CLI wrapper (or drop) | Low | Simpler, more reliable agent integration |

### Tier 3: Future Considerations

| Change | Effort | Impact |
|--------|--------|--------|
| Rust core via napi-rs (replace node-pty with ruspty) | Very High | Single-binary distribution, no node-gyp |
| WASM plugin system (Zellij model) | Very High | Extensibility without risking stability |
| Tauri desktop app | High | 2.5MB binary vs Electron's 80MB |
| Define an AI-terminal interaction protocol/standard | Medium | Category-defining, community building |

### What NOT to Do

- **Don't integrate Warp as a dependency** — closed-source terminal, can't be embedded. But study its patterns: OSC 777 agent-terminal protocol, block model, `oz` CLI local+cloud execution, agent auto-detection. See `09-warp-api-corrected.md` for full corrected assessment.
- **Don't use Gridland** — solves the opposite problem (TUI→web, not web→terminal)
- **Don't embed WezTerm/Kitty/Alacritty** — desktop-only renderers
- **Don't over-invest in MCP** — the 2026 consensus is that CLI tools are beating MCP for dev tools

---

## 7. Technology Decisions

### Keep
- **node-pty** (for now) — used by VS Code, mature, correct approach
- **SQLite WAL** — faster than filesystem for blobs under 100KB, already working
- **dtach** — session persistence, already integrated
- **React 19** — frontend framework, no reason to change
- **Socket.IO** — for web UI real-time (but NOT for CLI/agent access)
- **Commander.js** — for CLI command routing (already works)

### Keep (Revised)
- **xterm.js + WebGL** — working well, no evidence of inadequacy. ghostty-web is a POC with critical blockers (no headless, no serialize, no parser hooks). Not worth the complexity.
- **HTTP REST for CLI** → **Unix domain socket + NDJSON**
- **MCP as primary agent interface** → **CLI as primary, MCP as optional thin wrapper**
- **Quiet-period command detection** → **OSC 133 shell integration injection** (keep quiet-period as fallback)

### Add
- **Shell integration script injection** (bash, zsh, fish)
- **Extend `command_events`** with `start_chunk`/`end_chunk` + FTS5 external content table
- **Daemon auto-start** (antd)
- **Synchronized output sequences** (DCS/DECSET 2026)
- **Asciicast v3 export** for session recording

### Track (Not Ready Yet)
- **@replit/ruspty** — eliminates node-gyp, battle-tested at Replit
- **libghostty sub-libraries** — beyond VT parser (input handling, GPU rendering)
- **Rio's Sugarloaf WebGPU renderer** — GPU-accelerated terminal in browser (not ready)

---

## 8. Messaging & Conversation Architecture

The synthesis so far focuses on the terminal half of ANT. But conversation/messaging is equally important — it's what makes ANT unique vs. every other terminal tool.

### Current State

**What works well:**
- Socket.IO real-time sync — messages propagate instantly to all clients
- Rich metadata — sender info, annotations, starred flags, threading
- Simple streaming protocol — chunk + end events are reliable
- FTS5-backed message search across sessions
- Flexible annotation model (thumbs, flags, stars, session ratings)
- Offline queue in localStorage, flushed on reconnect

**What's awkward:**
- **Chairman + Message Bridge redundancy** — both poll separately for overlapping concerns (task routing vs. @mention injection)
- **Terminal injection is fire-and-forget** — no ACK mechanism to confirm agent received an @mention
- **Protocol syntax leaks** — agents must output `ANTchat! [room-name] "text"` but UI doesn't enforce or visualize this consistently
- **Threading is flat** — single-level only, no nested replies
- **Identity binding is optional** — `sender_terminal_id` FK exists but isn't required, creating spoofing surface
- **Room-to-session coupling is confusing** — dual linkage via `conversation_session_id` and nullable `antchat_room_id`

### How It Should Evolve in v2

**A. Daemon-Centric Messaging**
- Move all message routing logic OUT of the web server into the daemon
- Daemon owns: terminal I/O, message delivery, orchestration
- Web server becomes a stateless view layer
- Terminal agents connect directly to daemon for lower latency

**B. Proper Identity & Authorization**
- Bind every message to authenticated agent identity at daemon level
- Don't accept `sender_name` from clients — derive from auth context
- Per-room ACLs (who can read/write)

**C. Message Router (replacing Chairman + Bridge)**
- Single routing service instead of two polling loops
- Pub/sub with explicit ACKs instead of grace-period polling
- Store routing decisions as first-class records (audit trail)
- Agents can respond with receipt/rejection/questions

**D. Conversation as First-Class Entity**
- Schema: `Conversation = {participants, scope, context_files, tasks, threading_model}`
- Messages belong to a Conversation, inherit its scope/permissions
- Per-conversation routing rules ("backend tasks → Claude, frontend → Cursor")

**E. Rich Threading**
- Unlimited nesting (replies-to-replies)
- Tree rendering with collapse/expand
- Query threads by root message ID + depth

**F. Observability**
- Every message: created → routed → delivered → read → ACKed
- Chairman decisions logged as visible events in chat
- Message Bridge injections recorded with success/failure

---

## 9. Risk Analysis

### ghostty-web Migration Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `@xterm/addon-serialize` incompatibility | **Critical** — HeadlessTerminalWrapper depends on it | Test before committing. If incompatible, keep xterm.js for server-side headless, use ghostty-web for browser rendering only |
| `@xterm/addon-fit` missing | Medium — auto-resize to container | Likely replaceable with ResizeObserver + manual cols/rows calculation |
| `@xterm/addon-webgl` not needed | Low — ghostty-web uses WASM canvas | Actually a win — eliminates WebGL context limits |
| `parser.registerOscHandler()` missing | **High** — ANT registers custom OSC handlers for 7, 133, 1337 | Must verify ghostty-web exposes equivalent parser hooks. If not, this is a blocker |
| Performance regression | Medium | Benchmark WASM vs WebGL rendering for ANT's typical workloads |
| Ecosystem maturity | Medium | ghostty-web is new (2025), used primarily by Coder. Smaller community than xterm.js |

**Fallback plan**: If ghostty-web doesn't support critical addons, use it *only* for browser-side rendering and keep `@xterm/headless` for server-side terminal state. This is a split architecture but still captures the VT compliance benefits.

### CLI-First Daemon Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing MCP integrations | High | Keep MCP as thin CLI wrapper during transition |
| Node.js startup time (~30ms per CLI invocation) | Low | Acceptable for most operations; daemon handles latency-sensitive paths |
| Daemon lifecycle complexity (crashes, restarts, stale PIDs) | Medium | dtach already survives crashes. Add PID file + stale detection |
| Web UI must work over both UDS and HTTP | Medium | Daemon serves HTTP/WS for web UI; UDS for CLI. Two listeners, one process |
| Remote access regression | High | Keep HTTP/WS as first-class path for remote/Tailscale access |

### Shell Integration Injection Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking user's shell config | Medium | Use the Ghostty/Kitty approach: override env vars only, never modify dotfiles |
| Unsupported shells (nushell, elvish, PowerShell) | Low | Fall back to quiet-period heuristic (already implemented) |
| Nested terminal sessions (tmux inside ANT) | Medium | Detect `$TMUX`/`$ZELLIJ_SESSION_NAME` and skip injection |
| Shell integration disabled by user | Low | Make it opt-out, not opt-in |

---

## 10. Phased Migration Plan

### Phase 0: Foundation (no breaking changes)
- [ ] Inject shell integration scripts for bash/zsh/fish on session creation
- [ ] Extend `command_events` table with `start_chunk`/`end_chunk` columns
- [ ] Add FTS5 external content table on `command_events` for full-text search
- [ ] Add synchronized output sequences (DCS) to eliminate flicker
- **Result**: Better command detection and searchability with zero UX changes

### Phase 1: CLI Rework (parallel to existing)
- [ ] Add Unix domain socket listener to existing Express server (alongside HTTP)
- [ ] Rewrite `packages/cli/src/client.ts` to prefer UDS, fall back to HTTP
- [ ] Add `ant session ensure <name>` idempotent command
- [ ] Add `--json` output to all CLI commands
- [ ] Add daemon auto-start on first CLI invocation
- **Result**: CLI works over UDS locally, HTTP remotely. No breaking changes.

### Phase 2: ghostty-web Evaluation (Browser Rendering Only)
- [ ] ~~Test ghostty-web addon compatibility~~ **Done** — serialize and headless are blockers; fit/unicode/weblinks have equivalents
- [ ] Monitor ghostty-web for headless mode and parser hook support
- [ ] When ghostty-web exits POC status: swap import in TerminalViewV2.tsx for browser rendering
- [ ] Keep `@xterm/headless` + `SerializeAddon` on server — no alternative exists
- [ ] For OSC parsing: intercept raw PTY stream before passing to ghostty-web
- **Result**: Better VT compliance for display. Server-side stack unchanged. Reversible.

### Phase 3: Block-Based UI
- [ ] Render command blocks with visual boundaries in TerminalViewV2
- [ ] Exit code indicators (green/red), duration, CWD display per block
- [ ] Block selection, copy, and "use as AI context" actions
- [ ] Block search across sessions via FTS5
- **Result**: Warp-like UX on top of existing terminal rendering

### Phase 4: Daemon Extraction
- [ ] Extract PTY management + SQLite + message routing into standalone `antd` daemon
- [ ] Daemon listens on UDS + HTTP/WS
- [ ] Web server becomes stateless: proxies to daemon, serves static assets
- [ ] MCP server becomes thin CLI wrapper: `ant exec`, `ant screen`, `ant ls`
- **Result**: Clean separation of concerns. Web UI, CLI, and agents all talk to same daemon.

### Phase 5: Messaging Rework
- [ ] Merge Chairman + Message Bridge into unified Message Router in daemon
- [ ] Add pub/sub with ACKs for agent message delivery
- [ ] Introduce Conversation entities with explicit scoping
- [ ] Add nested threading support
- [ ] Add proper identity binding (derive from auth, not client-provided)
- **Result**: Reliable, auditable message routing with clear ownership

### Phase 6: Future
- [ ] Evaluate Rust core via napi-rs for single-binary distribution
- [ ] WASM plugin system for extensibility
- [ ] Asciicast v3 session recording/export
- [ ] Define and publish AI-terminal interaction protocol specification

---

## Raw Research Files

| File | Agent | Content |
|------|-------|---------|
| `01-session-capture-state-detection-raw.md` | Session Capture & State Detection | OSC sequences, shell integration protocols, PTY state monitoring, activity/idle detection |
| `02-warp-modern-terminals-raw.md` | Warp & Modern Terminals | Warp, Ghostty/ghostty-web, WezTerm, Kitty, Zellij, Rio, Wave, Alacritty evaluation |
| `03-terminal-io-capture-storage-raw.md` | Terminal I/O Capture & Storage | Programmatic input, structured output storage, command boundaries, PTY libraries |
| `04-cli-architecture-raw.md` | CLI Architecture | Daemon design, IPC patterns, tmux/zellij models, MCP vs CLI analysis |
| `05-competitive-landscape-raw.md` | Competitive Landscape | Claude Code, Cursor, Warp, Zed, Wave, emerging patterns, hooks ecosystem |
| `06-cli-vs-mcp-credibility-analysis.md` | CLI vs MCP Credibility | Source verification for reliability statistics, counter-arguments, nuanced framing |
| `07-messaging-architecture-analysis.md` | Messaging Architecture | Current message flow, threading, chat rooms, Chairman, Message Bridge, v2 evolution |
| `08-ghostty-web-addon-compatibility.md` | ghostty-web Compatibility | Detailed addon compatibility analysis for ANT's specific xterm.js usage |
| `09-warp-api-corrected.md` | Warp API (Corrected) | Oz API, Oz CLI, OSC 777 protocol, URI scheme — fuller picture than initial research |
