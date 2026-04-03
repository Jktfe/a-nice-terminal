# ANT v2: Orchestration Layer Architecture

> ANT is not a terminal. ANT is the orchestration and conversation layer above native terminals.

## Core Insight

ANT's value is NOT terminal rendering. Ghostty (or any native terminal) does that better than any web solution ever could. ANT's value is:

1. **Conversations** — structured messaging between humans and AI agents
2. **Cross-terminal workflows** — coordinating work across multiple agent sessions
3. **Capture & search** — command history, output indexing, session recording
4. **Orchestration** — creating terminals, routing messages, managing agent lifecycles
5. **Visibility** — a web dashboard showing what's happening across all terminals

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

### Session State Capture

ANT doesn't need to render terminal content. It captures metadata:

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
| **No terminal buffer access** | Can't read what's on screen via AppleScript. No `ant screen` equivalent. | Shell hooks capture command output. For raw screen state, would need Ghostty to add a buffer-read API (or use libghostty when available). |
| **Agent output capture** | Can't capture raw ANSI output for replay/recording. | Shell hooks capture text. For full ANSI recording, use `script` command wrapping or asciinema inside the Ghostty session. |
| **Ghostty dependency** | Users must install and use Ghostty. | Ghostty is MIT-licensed, free, and increasingly popular (49K+ stars). Reasonable to require for the premium experience. |
| **Split attention** | User looks at Ghostty for terminal, browser for ANT web UI. | This is actually fine — it's the same as using Slack alongside your IDE. ANT web UI is for the conversation/orchestration view, not terminal interaction. |

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
