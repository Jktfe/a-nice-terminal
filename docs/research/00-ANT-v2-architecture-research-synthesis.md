# ANT v2 Architecture Research Synthesis

> Research conducted April 2026. Five parallel research agents explored session capture, modern terminals, terminal I/O, CLI architecture, and competitive landscape.
> Raw findings in companion files `01-05` in this directory.

---

## Executive Summary

ANT's core architecture (node-pty + xterm.js + Socket.IO + SQLite) is fundamentally sound, but the **transport and interface layers are over-engineered** for what they do. The biggest wins come from:

1. **Replace xterm.js with ghostty-web** — drop-in swap, better VT compliance, WASM-based
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

### Migration Path

The API is compatible. Migration is literally changing the import:
```typescript
// Before
import { Terminal } from '@xterm/xterm';
// After  
import { Terminal } from 'ghostty-web';
```

### What to Watch

- xterm.js itself has an [open issue (#5686)](https://github.com/xtermjs/xterm.js/issues/5686) discussing adopting libghostty internally
- **libghostty** sub-libraries beyond the VT parser (input handling, GPU rendering) are coming — could eventually provide a full web terminal stack
- ghostty-web is new — evaluate addon compatibility (serialize, fit, webgl, web-links, unicode11) before committing

### Verdict

**Strong candidate.** Evaluate addon compatibility first. If the serialize addon (needed for headless terminal state) works or has an equivalent, this is a clear upgrade.

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

### The 2026 Consensus: CLI > MCP for Dev Tools

Research from multiple sources confirms:
- CLI tools achieve **100% reliability** vs MCP's **72%** for equivalent tasks
- A GitHub MCP server dumps **~55,000 tokens** of schema before the first question; CLI uses 10-32x fewer
- LLMs are trained on billions of terminal interactions — they already "know" CLIs natively
- Debugging: `set -x` and `stderr` vs cascading JSON-RPC/transport/schema failures

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
                     │  │  /run/user/uid/ant/  │    │
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
2. **Store blocks in a new table**:

```sql
command_blocks:
  id            TEXT PRIMARY KEY
  session_id    TEXT
  command       TEXT          -- stripped text of command
  output_text   TEXT          -- stripped text for FTS
  exit_code     INTEGER
  cwd           TEXT
  started_at    TEXT
  completed_at  TEXT
  duration_ms   INTEGER
  detection     TEXT          -- 'osc133' or 'quiet'
  start_chunk   INTEGER      -- FK to terminal_output_events
  end_chunk     INTEGER      -- FK to terminal_output_events
```

3. **Add FTS5 virtual table** on `command_blocks.output_text` and `command_blocks.command` for full-text search across all sessions
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
| Add `command_blocks` table + FTS5 | Medium | Enables Warp-like searchable command history |
| Restructure CLI to use UDS instead of HTTP | Medium | Eliminates 3 hops, feels native |
| Add daemon auto-start (`antd`) | Low | tmux-like UX |

### Tier 2: Major Upgrades

| Change | Effort | Impact |
|--------|--------|--------|
| Replace xterm.js with ghostty-web | Medium (test addon compat first) | Better VT compliance, future-proof |
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

- **Don't integrate Warp** — proprietary, no terminal control API, can't be embedded
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

### Replace
- **xterm.js** → **ghostty-web** (after addon compatibility testing)
- **HTTP REST for CLI** → **Unix domain socket + NDJSON**
- **MCP as primary agent interface** → **CLI as primary, MCP as optional thin wrapper**
- **Quiet-period command detection** → **OSC 133 shell integration injection** (keep quiet-period as fallback)

### Add
- **Shell integration script injection** (bash, zsh, fish)
- **command_blocks table** with FTS5
- **Daemon auto-start** (antd)
- **Synchronized output sequences** (DCS/DECSET 2026)
- **Asciicast v3 export** for session recording

### Track (Not Ready Yet)
- **@replit/ruspty** — eliminates node-gyp, battle-tested at Replit
- **libghostty sub-libraries** — beyond VT parser (input handling, GPU rendering)
- **Rio's Sugarloaf WebGPU renderer** — GPU-accelerated terminal in browser (not ready)

---

## Raw Research Files

| File | Agent | Content |
|------|-------|---------|
| `01-session-capture-state-detection-raw.md` | Session Capture & State Detection | OSC sequences, shell integration protocols, PTY state monitoring, activity/idle detection |
| `02-warp-modern-terminals-raw.md` | Warp & Modern Terminals | Warp, Ghostty/ghostty-web, WezTerm, Kitty, Zellij, Rio, Wave, Alacritty evaluation |
| `03-terminal-io-capture-storage-raw.md` | Terminal I/O Capture & Storage | Programmatic input, structured output storage, command boundaries, PTY libraries |
| `04-cli-architecture-raw.md` | CLI Architecture | Daemon design, IPC patterns, tmux/zellij models, MCP vs CLI analysis |
| `05-competitive-landscape-raw.md` | Competitive Landscape | Claude Code, Cursor, Warp, Zed, Wave, emerging patterns, hooks ecosystem |
