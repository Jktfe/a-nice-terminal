# ANT v2: Orchestration Layer Architecture

> ANT is not a terminal. ANT is the persistent memory and orchestration layer above native terminals.

## Core Insight

ANT's value is NOT terminal rendering. Ghostty (or any native terminal) does that better than any web solution ever could. ANT's value is:

1. **Permanent memory** — when Claude/Gemini compact context and clear the terminal, the full conversation remains in ANT, searchable, scrollable, accessible from any device
2. **Resilience** — agents keep working even if ANT goes down; ANT catches up on reconnect
3. **Conversations** — structured messaging between humans and AI agents
4. **Cross-terminal workflows** — coordinating work across multiple agent sessions
5. **Full I/O capture** — every byte in and out, stored permanently, defeating terminal scrollback limits
6. **Orchestration** — creating terminals, routing messages, managing agent lifecycles
7. **Mobile/remote access** — the full conversation on your phone even when the terminal has been compacted

## The Problem ANT Solves

LLM CLI tools (Claude Code, Gemini CLI, Aider, etc.) have a fundamental UX problem:

1. **Context compaction clears the terminal** — the LLM decides to compact, your scrollback is gone
2. **Terminal scrollback is finite** — even without compaction, long sessions overflow the buffer
3. **No cross-device access** — you can't pick up your phone and see what Claude is doing
4. **No search across sessions** — finding that command from yesterday means grepping logs
5. **Agent crashes lose context** — if the process dies, the conversation is gone
6. **No cross-agent visibility** — three agents working on your project, no unified view

ANT defeats all of these by sitting above the terminal, capturing everything, and storing it permanently in a searchable database accessible from any device.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    ANT Web UI                             │
│                                                          │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐ │
│  │ Conversation │ │ Terminal     │ │ Cross-Terminal     │ │
│  │ View         │ │ Dashboard    │ │ Workflow View      │ │
│  │              │ │              │ │                    │ │
│  │ Messages     │ │ Per-terminal │ │ Agent A is doing X │ │
│  │ Threads      │ │ command      │ │ Agent B waiting on │ │
│  │ @mentions    │ │ blocks,      │ │ Agent C finished Y │ │
│  │ Annotations  │ │ status,      │ │                    │ │
│  │ Task board   │ │ CWD, idle/   │ │ Dependencies,      │ │
│  │              │ │ active       │ │ parallel streams   │ │
│  └─────────────┘ └──────────────┘ └───────────────────┘ │
└──────────────────────────┬───────────────────────────────┘
                           │
                     HTTP/WS (web UI)
                           │
┌──────────────────────────┴───────────────────────────────┐
│                    antd (daemon)                          │
│                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │ Message      │ │ Terminal     │ │ Command Block    │ │
│  │ Router       │ │ Orchestrator │ │ Indexer          │ │
│  │              │ │              │ │                  │ │
│  │ Replaces     │ │ AppleScript  │ │ OSC 133 capture  │ │
│  │ Chairman +   │ │ bridge to    │ │ FTS5 search      │ │
│  │ Message      │ │ Ghostty      │ │ Asciicast export │ │
│  │ Bridge       │ │              │ │                  │ │
│  └──────────────┘ └──────────────┘ └──────────────────┘ │
│                                                          │
│  ┌──────────────┐ ┌──────────────┐                      │
│  │ Session      │ │ SQLite       │                      │
│  │ State        │ │ WAL          │                      │
│  │              │ │              │                      │
│  │ Per-terminal │ │ Messages     │                      │
│  │ metadata,    │ │ Command evts │                      │
│  │ agent info,  │ │ Sessions     │                      │
│  │ CWD, status  │ │ Workspaces   │                      │
│  └──────────────┘ └──────────────┘                      │
│                                                          │
│  UDS: $XDG_RUNTIME_DIR/ant/antd.sock                    │
└──────────────────────────┬───────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         AppleScript  AppleScript  AppleScript
         + OSC 133    + OSC 133    + OSC 133
              │            │            │
         ┌────┴────┐  ┌───┴────┐  ┌───┴────┐
         │ Ghostty │  │ Ghostty│  │ Ghostty│
         │ Tab 1   │  │ Tab 2  │  │ Tab 3  │
         │         │  │        │  │        │
         │ Claude  │  │ Cursor │  │ human  │
         │ Code    │  │ agent  │  │ shell  │
         └─────────┘  └────────┘  └────────┘
```

## What ANT Does (Orchestration Layer)

### Terminal Orchestration via AppleScript

```applescript
-- Create a new terminal for an agent
tell application "Ghostty"
    set cfg to new surface configuration
    set working directory of cfg to "/Users/me/project"
    set command of cfg to "claude --resume"
    set environment of cfg to {"ANT_SESSION_ID=abc123", "ANT_AGENT=claude-1"}
    new tab with configuration cfg
end tell

-- Send input to a specific terminal
tell application "Ghostty"
    tell terminal id "xyz"
        input text "npm test" & return
    end tell
end tell

-- Query which terminals are in a project directory
tell application "Ghostty"
    set projectTerminals to every terminal whose working directory contains "/project"
end tell

-- Focus a specific terminal
tell application "Ghostty"
    tell terminal id "xyz"
        focus
    end tell
end tell
```

### Full I/O Capture (The Core Value)

ANT captures **every byte** flowing through the terminal — not just command events, but the entire conversation stream. When Claude compacts context and clears the terminal, ANT still has everything.

**Architecture: `script`-style wrapper**

When ANT creates a Ghostty terminal, it wraps the agent command:

```applescript
tell application "Ghostty"
    set cfg to new surface configuration
    set command of cfg to "/usr/local/bin/ant-capture abc123 claude --resume"
    set environment of cfg to {"ANT_SESSION_ID=abc123"}
    new tab with configuration cfg
end tell
```

Where `ant-capture` is a thin wrapper:

```bash
#!/bin/bash
# ant-capture <session-id> <command...>
SESSION_ID="$1"; shift
FIFO="$XDG_RUNTIME_DIR/ant/capture/$SESSION_ID"
mkfifo "$FIFO.in" "$FIFO.out" 2>/dev/null

# Tee all output to the FIFO for antd to consume
# The command runs normally in the terminal — user sees everything
# antd reads the FIFO and stores permanently
script -q -F "$FIFO.out" -c "$*" 2>&1 | tee >(
    while IFS= read -r line; do
        echo "$line" > "$FIFO.out"
    done
) &

# Or simpler: use typescript recording
exec script -q -F "$XDG_RUNTIME_DIR/ant/capture/$SESSION_ID.log" -c "$*"
```

**What antd does with the stream:**

1. **Stores raw bytes** — complete ANSI stream in `terminal_output_events`, chunked and timestamped
2. **Strips to text** — parallel stripped-text version for FTS5 search
3. **Detects command boundaries** — via OSC 133 markers or shell hook events
4. **Indexes command blocks** — command text + output text in `command_events` with FTS5
5. **Detects context compaction** — when the LLM emits a clear-screen sequence (CSI 2 J or CSI 3 J), ANT notes it but **keeps all prior content**

**The result:** The terminal can clear, compact, or crash. ANT has the complete, permanent, searchable record.

### Resilience: ANT Down ≠ Agent Down

The capture wrapper (`ant-capture` / `script`) writes to a local log file. If antd goes down:

1. The agent keeps running in Ghostty — nothing depends on antd for terminal operation
2. The `script` log file keeps growing on disk
3. When antd comes back, it reads the log file from where it left off (cursor stored in SQLite)
4. Full catch-up: every byte captured, no gaps

This is better than dtach because the agent process isn't even aware ANT exists. It's just a shell running in Ghostty. The capture is a transparent wrapper.

### Mobile Access

The web UI (accessible via Tailscale on your phone) shows:

- **Full conversation history** — every command and output, permanently
- **Smooth scrolling** — it's a web page rendering stored text, not a terminal buffer
- **Search** — FTS5 across all sessions, all time
- **Live status** — which agents are active, idle, waiting for input
- **Message threads** — the conversation layer alongside terminal output

When Claude compacts context and clears the terminal at 2am, you wake up, open ANT on your phone, and the entire conversation is there — searchable, scrollable, with command blocks, exit codes, and timestamps.

### Session State Capture

In addition to full I/O, ANT captures structured metadata:

1. **OSC 133 markers** (Ghostty natively emits these) — command boundaries, exit codes, timing
2. **OSC 7** — working directory changes
3. **OSC 1337** — hostname, user, custom variables
4. **Shell integration env vars** — `ANT_SESSION_ID` injected at creation, used to correlate

**How ANT sees the OSC stream without being in the PTY path:**

Option A: **Shell integration scripts** that POST events to antd
```bash
# Injected into agent's shell via env vars at terminal creation
precmd() {
    curl -s --unix-socket $XDG_RUNTIME_DIR/ant/antd.sock \
      -X POST /events \
      -d "{\"session\":\"$ANT_SESSION_ID\",\"event\":\"command_end\",\"exit_code\":$?,\"cwd\":\"$PWD\"}"
}
preexec() {
    curl -s --unix-socket $XDG_RUNTIME_DIR/ant/antd.sock \
      -X POST /events \
      -d "{\"session\":\"$ANT_SESSION_ID\",\"event\":\"command_start\",\"command\":\"$1\"}"
}
```

Option B: **Named pipe/file watcher** — shell hooks write to a per-session FIFO that antd reads

Option C: **Ghostty plugin** (when libghostty matures) — intercept OSC in-process

### Conversation & Messaging

This is ANT's primary UI — unchanged from current, but cleaner:

- Messages between humans and agents
- Threading (upgrade to nested)
- Chat rooms with multiple agents
- @mention routing (now via Message Router, not fire-and-forget PTY injection)
- Task tracking and assignment
- Annotations, ratings, starred messages

### Cross-Terminal Workflows

The unique value no one else has:

- **Dependency graph**: "Agent A's output feeds Agent B's input"
- **Parallel streams**: "3 agents working on different parts of a feature"
- **Status dashboard**: per-terminal status (idle/active/waiting-for-input/error)
- **Workflow templates**: "Start a backend agent, frontend agent, and test watcher"

## What ANT Does NOT Do

- **Does not render terminals** — Ghostty does that natively
- **Does not manage PTYs** — Ghostty owns the PTY
- **Does not parse ANSI** — no xterm.js, no headless terminal, no serialize addon
- **Does not handle input** — Ghostty's native input handling is superior

## What Gets Deleted

| Current Component | Status | Reason |
|---|---|---|
| `node-pty` | **Remove** | Ghostty manages PTYs |
| `xterm.js` + all addons | **Remove** | Ghostty renders natively |
| `@xterm/headless` | **Remove** | No server-side terminal emulation needed |
| `HeadlessTerminalWrapper` | **Remove** | Replaced by shell integration event capture |
| `SerializeAddon` | **Remove** | No terminal state to serialize |
| `TerminalViewV2.tsx` (32KB) | **Remove** | No web-based terminal rendering |
| `terminal-namespace.ts` (Socket.IO binary PTY relay) | **Remove** | No PTY data flowing through ANT |
| `dtach` integration | **Remove** | Ghostty manages session persistence |
| WebGL addon | **Remove** | Native GPU rendering in Ghostty |

## What Gets Simpler

| Concern | Before | After |
|---|---|---|
| Terminal rendering | xterm.js + WebGL + addons + Socket.IO binary relay | Ghostty native (zero ANT code) |
| Command detection | HeadlessTerminal + CommandTracker + quiet-period heuristic | Shell hooks POST to antd (3 lines of bash) |
| Input injection | node-pty.write() + bracketed paste handling | `input text` / `send key` via AppleScript |
| Session persistence | dtach + orphan reaping + re-adoption | Ghostty tabs persist natively |
| Terminal state | Headless terminal mirror + serialize + buffer parsing | CWD from AppleScript query, status from shell hooks |

## What Gets Harder (Honest Assessment)

| Concern | Challenge | Mitigation |
|---|---|---|
| **macOS only** (today) | AppleScript is macOS-only. Linux Ghostty has no equivalent IPC. | Accept macOS-first. Linux support via fallback to node-pty path (current architecture) or wait for libghostty cross-platform API. |
| **No terminal buffer access** | Can't read what's currently on screen via AppleScript. | ANT has the full stream via `script` capture — can reconstruct current screen by replaying recent ANSI. Or: `ant screen` replays last N bytes through a headless parser on demand (lazy, not continuous). |
| **Ghostty dependency** | Users must install and use Ghostty. | Ghostty is MIT-licensed, free, and increasingly popular (49K+ stars). Reasonable to require for the premium experience. |
| **Split attention** | User looks at Ghostty for terminal, browser for ANT web UI. | This is actually the point — Ghostty is where you type, ANT web UI is where you review, search, coordinate across agents, and access from mobile. Same as Slack alongside your IDE. |
| **Capture wrapper overhead** | `script` / `tee` adds a process to the pipe. | Negligible — `script` is a decades-old Unix utility designed for this. Sub-millisecond overhead. |

## The ant CLI in This Model

```bash
# Session management (talks to antd over UDS)
ant ls                              # list tracked terminals
ant create "backend-agent"          # create Ghostty tab via AppleScript
ant focus "backend-agent"           # focus that terminal

# Messaging (same CLI, same daemon)
ant msg send "backend" "run tests"  # post to conversation
ant msg list "backend" --since 1h   # query history

# Orchestration
ant workflow start "full-stack"     # launch pre-defined multi-agent workflow
ant status                          # dashboard of all terminal states

# For AI agents (via Bash tool)
ant exec "backend" "npm test" --json  # send command, wait for shell hook result
ant events "backend" --since 5m --json  # get recent command events
```

## Phased Migration

### Phase 1: Shell Integration Hooks (no architecture change)
- Write bash/zsh/fish shell integration scripts
- Scripts POST command events to antd via UDS
- Inject via env vars when creating sessions
- Store events in `command_events` table with FTS5
- **Works with current node-pty architecture AND future Ghostty architecture**

### Phase 2: AppleScript Bridge
- Build `terminal-orchestrator.ts` module
- Wrap AppleScript commands: create, input, focus, query, close
- Create Ghostty tabs with `ANT_SESSION_ID` env var
- Shell hooks correlate events back to ANT sessions

### Phase 3: Remove PTY Layer
- Stop using node-pty for macOS Ghostty-backed sessions
- Remove xterm.js, headless terminal, serialize addon
- TerminalViewV2 replaced with "Terminal Dashboard" (metadata only, no rendering)
- Keep node-pty path as fallback for Linux/headless

### Phase 4: Cross-Terminal Workflows
- Dependency graphs between terminals
- Workflow templates (multi-agent launch configurations)
- Status aggregation dashboard
- Parallel stream visualization

### Phase 5: Message Router
- Unify Chairman + Message Bridge
- Pub/sub with ACKs
- Per-conversation routing rules
- Agent identity from auth context

## Platform Strategy

| Platform | Terminal Backend | Control Method | Status |
|---|---|---|---|
| **macOS** | Ghostty | AppleScript + shell hooks | Primary target |
| **macOS (alt)** | Any terminal | Shell hooks only (no orchestration) | Degraded mode |
| **Linux** | Ghostty | D-Bus / libghostty (when available) | Future |
| **Linux (fallback)** | node-pty + current arch | Direct PTY management | Maintained |
| **Remote/headless** | node-pty + current arch | Full current architecture | Maintained |
