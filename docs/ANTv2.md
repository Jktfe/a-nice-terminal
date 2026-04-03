# ANT v2: Complete Planning Document

> **ANT is not a terminal. ANT is the persistent memory, Chat layer, and orchestration hub above native terminals.**

**Date:** April 2026
**Target Platform:** macOS (primary), Linux (fallback)
**Terminal Backend:** Ghostty (via AppleScript)
**Status:** Active build — Phase 1 in progress

---

## Vocabulary

These terms are locked. Use them consistently everywhere — in code, comments, UI, and docs.

| Term | Meaning | Replaces |
|---|---|---|
| **Chat** | A messaging thread — what v1 called "conversation" or "session" (messaging context) | conversation, room, session (messaging) |
| **Chair** | The always-on intelligent forwarding agent that monitors all Chats and all Terminals | Chairman, Message Router, orchestration agent |
| **Terminal** | A captured shell session (Ghostty tab + ant-capture) | terminal session, PTY session |

---

## Table of Contents

1. [Vision & Core Problem](#1-vision--core-problem)
2. [Architecture Overview](#2-architecture-overview)
3. [v1 Feature Migration Map](#3-v1-feature-migration-map)
4. [Core Systems](#4-core-systems)
5. [Database Schema](#5-database-schema)
6. [CLI Design](#6-cli-design)
7. [Web UI](#7-web-ui)
8. [Knowledge Pipeline](#8-knowledge-pipeline)
9. [Platform Strategy](#9-platform-strategy)
10. [What Gets Deleted](#10-what-gets-deleted)
11. [Phased Build Plan](#11-phased-build-plan)
12. [Risk Analysis](#12-risk-analysis)
13. [Open Questions](#13-open-questions)

---

## 1. Vision & Core Problem

### The Problem

LLM CLI tools (Claude Code, Gemini CLI, Aider, etc.) have fundamental UX problems:

1. **Context compaction clears the terminal** — the LLM compacts, your scrollback is gone
2. **Terminal scrollback is finite** — long sessions overflow the buffer
3. **No cross-device access** — can't check what Claude is doing from your phone
4. **No search across sessions** — finding that command from yesterday means grepping logs
5. **Agent crashes lose context** — process dies, conversation gone
6. **No cross-agent visibility** — three agents on your project, no unified view
7. **No learning across agents** — Claude solved a problem Gemini is stuck on, but neither knows

### ANT's Value Proposition

ANT defeats all of these by sitting **above** the terminal:

| Capability | How |
|---|---|
| **Permanent memory** | Captures every byte of terminal I/O via `ant-capture` wrapper. When Claude compacts context, ANT still has everything — searchable, scrollable, accessible from any device |
| **Conversation layer** | Chat alongside/above terminals with full context. Ask "did another agent try this?" and ANT answers from indexed history |
| **Cross-terminal intelligence** | FTS5 search across all sessions, all time. "Look at sessions X and Y" is a query ANT can serve |
| **Fire-and-forget agents** | Launch a GPT-OSS agent, walk away, go to bed. Full terminal capture whether you watch or not. Jump in anytime |
| **Human-in-the-loop input** | Type into any terminal from web UI or phone. Approve prompts, send commands — same mechanism for humans and agents |
| **Knowledge pipeline** | Archived sessions → processed → Obsidian vaults with wikilinks, tags, summaries. Knowledge compounds over time |
| **Resilience** | Agents run in Ghostty tabs. ANT going down doesn't affect them. `ant-capture` writes to local files. antd catches up on restart |

### What ANT Does NOT Do

- **Does not render terminals** — Ghostty does that natively, better than any web solution
- **Does not manage PTYs** — Ghostty owns the PTY
- **Does not parse ANSI for display** — no xterm.js, no headless terminal, no serialize addon
- **Does not handle keyboard input** — Ghostty's native input is superior
- **Does not call LLMs** — ANT launches terminals; what runs inside is the user's choice

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    ANT Web UI                             │
│                                                          │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐ │
│  │ Conversation │ │ Terminal     │ │ Cross-Terminal     │ │
│  │ View         │ │ Dashboard    │ │ Workflow View      │ │
│  │              │ │              │ │                    │ │
│  │ Messages     │ │ Per-terminal │ │ Agent A doing X    │ │
│  │ Threads      │ │ command      │ │ Agent B waiting    │ │
│  │ @mentions    │ │ blocks,      │ │ Agent C finished Y │ │
│  │ Annotations  │ │ status, CWD  │ │                    │ │
│  │ Task board   │ │              │ │ Dependencies,      │ │
│  │              │ │              │ │ parallel streams   │ │
│  └─────────────┘ └──────────────┘ └───────────────────┘ │
└──────────────────────────┬───────────────────────────────┘
                           │
                     HTTP/WS (web UI + mobile via Tailscale)
                           │
┌──────────────────────────┴───────────────────────────────┐
│                    antd (daemon)                          │
│                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │ Message      │ │ Terminal     │ │ Capture          │ │
│  │ Router       │ │ Orchestrator │ │ Ingest           │ │
│  │              │ │              │ │                  │ │
│  │ Replaces     │ │ AppleScript  │ │ Tails .log +    │ │
│  │ Chairman +   │ │ bridge to    │ │ .events files   │ │
│  │ Bridge       │ │ Ghostty      │ │ FTS5 indexing   │ │
│  └──────────────┘ └──────────────┘ └──────────────────┘ │
│                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │ Session      │ │ SQLite WAL   │ │ Knowledge        │ │
│  │ State        │ │              │ │ Pipeline         │ │
│  │              │ │ All tables   │ │                  │ │
│  │ Per-terminal │ │ from v1 +    │ │ Sessions →       │ │
│  │ metadata     │ │ capture      │ │ Obsidian export  │ │
│  └──────────────┘ └──────────────┘ └──────────────────┘ │
│                                                          │
│  UDS: $XDG_RUNTIME_DIR/ant/antd.sock                    │
└──────────────────────────┬───────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ant-capture  ant-capture  ant-capture
         + shell hooks + shell hooks + shell hooks
              │            │            │
         ┌────┴────┐  ┌───┴────┐  ┌───┴────┐
         │ Ghostty │  │ Ghostty│  │ Ghostty│
         │ Tab 1   │  │ Tab 2  │  │ Tab 3  │
         │         │  │        │  │        │
         │ Claude  │  │ Gemini │  │ human  │
         │ Code    │  │ CLI    │  │ shell  │
         └─────────┘  └────────┘  └────────┘
```

### Data Flow

1. **ANT creates a Ghostty tab** via AppleScript, wrapping the shell with `ant-capture`
2. **ant-capture** uses Unix `script` to tee all I/O to a `.log` file transparently
3. **Shell integration hooks** (injected via BASH_ENV/ZDOTDIR) emit structured NDJSON events to `.events` file
4. **antd's CaptureIngest** polls `.log` and `.events` files, storing chunks in SQLite
5. **Web UI** reads from SQLite via HTTP/WS, renders conversation + terminal dashboard
6. **CLI** talks to antd over Unix domain socket for low-latency local operations

### Key Design Principles

- **Unix domain socket** for local IPC (~5-10μs vs ~1-5ms for HTTP)
- **NDJSON over UDS** — human-readable, debuggable
- **Daemon auto-start** on first CLI invocation (like tmux)
- **Every CLI command supports `--json`** for machine consumption
- **CLI-first, MCP optional** — agents use `ant` CLI via Bash tool
- **Idempotent operations** — `ant session ensure <name>` creates-or-returns
- **Exit codes are semantic** — 0=success, 1=error, 2=not found

---

## 3. v1 Feature Migration Map

Every v1 feature accounted for. Nothing lost without a reason.

### Terminal Management

| v1 Feature | v1 Implementation | v2 Status | v2 Implementation |
|---|---|---|---|
| Terminal sessions | node-pty + dtach | **Replaced** | Ghostty tabs via AppleScript. `ant-capture` wraps shell with `script` for I/O capture |
| PTY management | node-pty spawns PTY, Socket.IO relays binary data | **Replaced** | Ghostty owns PTY natively. No PTY management in ANT |
| Session persistence (dtach) | dtach keeps process alive if ANT dies | **Replaced** | Ghostty tabs persist independently. `ant-capture` writes to local files — antd crash doesn't affect agents |
| Terminal rendering | xterm.js + WebGL addon in browser | **Replaced** | Ghostty renders natively. Web UI shows captured output as text/command blocks (not a live terminal emulator) |
| Headless terminal mirror | @xterm/headless + SerializeAddon server-side | **Removed** | Not needed — ANT captures raw I/O stream, not terminal state. On-demand screen reconstruction from recent ANSI if needed |
| Terminal resize | node-pty.resize() via Socket.IO | **Replaced** | Not ANT's concern — Ghostty handles natively |
| Terminal themes | xterm.js theme options | **Replaced** | Ghostty's native theming. Web UI has its own theme for conversation/dashboard views |
| Command detection | HeadlessTerminal + CommandTracker + quiet-period heuristic | **Replaced** | Shell integration hooks (precmd/preexec) emit OSC 133 markers + NDJSON events. Precise, not heuristic |
| Terminal output storage | terminal_output_events table, chunked | **Kept** | Same table, fed by CaptureIngest polling .log files instead of Socket.IO relay |
| Resume commands | resume_commands table, dropdown UI | **Kept** | Same — useful for quick re-execution. Fed from shell hook command_start events |
| Terminal locks | terminal_locks table, per-agent exclusive access | **Kept** | Same concept. AppleScript `input text` respects lock state in antd |
| Input injection | node-pty.write() + bracketed paste | **Replaced** | Ghostty AppleScript: `input text "command" & return` |
| Terminal attach (CLI) | `ant attach` → Socket.IO binary stream to local TTY | **Replaced** | `ant focus <session>` brings Ghostty tab to front via AppleScript. For remote: web UI shows captured output |

### Messaging & Conversation

| v1 Feature | v1 Implementation | v2 Status | v2 Implementation |
|---|---|---|---|
| Messages | messages table with role, format, metadata | **Kept** | Same schema. Messages now route through daemon Message Router instead of Express |
| Message streaming | Socket.IO chunk + end events | **Kept** | Same protocol for web UI. CLI uses UDS streaming |
| Message threading | Single-level thread_id FK | **Evolved** | Nested threading — unlimited depth, tree rendering with collapse/expand |
| Message starring | is_starred boolean | **Kept** | Same |
| Message annotations | Flexible model (thumbs, flags, stars, ratings) | **Kept** | Same |
| Message search (FTS5) | messages_fts virtual table | **Kept** | Same, extended to also search terminal output via command_events_fts |
| Offline message queue | localStorage flush on reconnect | **Kept** | Same pattern for web UI |
| Sender identity | sender_name, sender_terminal_id | **Evolved** | Identity derived from auth context at daemon level — no client-provided sender_name spoofing |
| @mention routing | Chairman + Bridge detect @mentions, inject into terminal | **Evolved** | Message Router handles all routing. Pub/sub with ACKs instead of fire-and-forget injection |

### Chat Rooms

| v1 Feature | v1 Implementation | v2 Status | v2 Implementation |
|---|---|---|---|
| Room registry | antchat_rooms table | **Kept** | Same, promoted to first-class Conversation entity |
| Participants | conversation_members table with agent joins | **Kept** | Same, with stricter identity binding |
| Room protocols | ANTchat!, ANTtask!, ANTfile! syntax in terminal output | **Evolved** | Protocols still supported for backward compat, but primary path is structured API calls via CLI/UDS |
| Context files | Per-room file references | **Kept** | Same |
| Room tags | Per-participant tags | **Kept** | Same |
| Room tasks | tasks table linked to rooms | **Kept** | Same, integrated into Task Board |

### Chairman / AI Orchestrator

| v1 Feature | v1 Implementation | v2 Status | v2 Implementation |
|---|---|---|---|
| Ambient monitoring | Polls all conversation sessions | **Evolved** | Message Router subscribes to all conversations via event stream (no polling) |
| Task detection | LLM analysis of incoming messages | **Kept** | Same capability, now in Message Router |
| Selective routing | Routes to relevant agents by domain | **Kept** | Same, with per-conversation routing rules |
| @mention routing | Detects @mentions, injects into terminal | **Evolved** | Message Router delivers via pub/sub with ACK. No grace-period polling |
| Stale task detection | Timer-based (3min assigned, 8min in-progress) | **Kept** | Same logic in Message Router |
| Terminal action approval | Chairman approves/rejects dangerous commands | **Kept** | Same, surfaced in web UI TerminalApprovalCard |
| LM Studio integration | Direct HTTP to local LLM | **Kept** | Message Router can use any OpenAI-compatible endpoint |

### Bridge (External Platforms)

| v1 Feature | v1 Implementation | v2 Status | v2 Implementation |
|---|---|---|---|
| Telegram relay | grammy bot, shared channel | **Kept** | Same adapter, connected to daemon instead of Express |
| Telegram direct bots | Per-agent bot tokens | **Kept** | Same |
| LM Studio adapter | /v1/chat/completions | **Kept** | Same |
| OpenAI-compatible adapter | Generic REST | **Kept** | Same |
| Terminal watcher | Polls PTY output for ANTchat! commands | **Evolved** | Watches captured .events file instead of PTY stream |
| Rate limiting | 10s window, max 20 msgs/chat | **Kept** | Same |
| Bidirectional mapping | Platform channel ↔ ANT session | **Kept** | Same |

### Knowledge System

| v1 Feature | v1 Implementation | v2 Status | v2 Implementation |
|---|---|---|---|
| Knowledge facts | knowledge_facts table with scope, confidence, evidence | **Kept** | Same |
| Error patterns | error_patterns table linked to fixes | **Kept** | Same |
| Knowledge links | Cross-references between sessions, facts, commands | **Kept** | Same |
| Session digests | LLM-extracted summaries before deletion | **Kept** | Same, now also fed by Knowledge Pipeline for Obsidian export |
| FTS5 on facts | knowledge_facts_fts | **Kept** | Same |

### Coordination & Recipes

| v1 Feature | v1 Implementation | v2 Status | v2 Implementation |
|---|---|---|---|
| Task broadcasting | coordination_events with capability matching | **Kept** | Same |
| Recipes | Reusable multi-step workflows with params | **Kept** | Same, can now launch multi-terminal workflows |
| Agent registry | agent_registry table with capabilities, context window | **Kept** | Same |
| Session permissions | Per-agent read/write/exec ACLs | **Kept** | Same |
| Dangerous commands | Pattern table with severity levels | **Kept** | Same, checked before AppleScript input injection |

### Infrastructure

| v1 Feature | v1 Implementation | v2 Status | v2 Implementation |
|---|---|---|---|
| SQLite WAL | better-sqlite3 | **Kept** | Same |
| Tailscale remote access | HTTPS via Tailscale | **Kept** | Same — web UI over Tailscale for mobile |
| TLS | ANT_TLS_CERT/KEY env vars | **Kept** | Same |
| API keys | ANT_API_KEY for authentication | **Kept** | Same |
| Notifications | ntfy.sh + Beeper push | **Kept** | Same |
| Workspaces | Session grouping and namespace | **Kept** | Same |
| Session TTL/tiers | sprint/session/persistent with retention policies | **Kept** | Same |
| Session archival | Archive/restore with search retention | **Kept** | Same |
| Connected devices | Multi-device awareness | **Kept** | Same |
| User preferences | Learned + explicit settings with confidence | **Kept** | Same |
| Common calls | Quick-copy command snippets | **Kept** | Same |
| File uploads | Upload handling | **Kept** | Same |

### Web UI Components

| v1 Component | v2 Status | Notes |
|---|---|---|
| Sidebar (session list + unread badges) | **Kept** | Same |
| MessageList | **Kept** | Same, with nested threading |
| TerminalViewV2 (xterm.js) | **Replaced** | Becomes Terminal Dashboard — command blocks, status, CWD. Not a live terminal emulator |
| ChatThread | **Evolved** | Nested threading support |
| InputArea | **Kept** | Same, plus "send to terminal" mode for input injection via AppleScript |
| SearchPanel | **Evolved** | Now searches terminal output (command_events_fts) in addition to messages |
| ChairmanPanel | **Evolved** | Becomes Message Router settings |
| TaskPanel | **Kept** | Same |
| KnowledgePanel | **Kept** | Same |
| CommonCallsPanel | **Kept** | Same |
| ChatRoomPanel | **Kept** | Same |
| SessionDashboard | **Evolved** | Adds per-terminal status (idle/active/waiting/error), CWD, agent info |
| SettingsModal | **Kept** | Same |
| QuickSwitcher (Cmd+K) | **Kept** | Same |
| MobileTabBar | **Kept** | Same |
| StatusBar | **Kept** | Same |
| OfflineOverlay | **Kept** | Same |
| SessionRating | **Kept** | Same |
| SenderAvatar | **Kept** | Same |
| TerminalApprovalCard | **Kept** | Same |
| ResumeDropdown | **Kept** | Same |
| SplitHeader | **Evolved** | Split between conversation and terminal dashboard (not terminal emulator) |

### CLI Commands

| v1 Command | v2 Status | Notes |
|---|---|---|
| `ant ls` | **Kept** | Same, adds `--json` |
| `ant create` | **Evolved** | Creates Ghostty tab via AppleScript + ant-capture wrapper |
| `ant read` | **Kept** | Reads from captured output instead of Socket.IO stream |
| `ant post` | **Kept** | Same for messages. Terminal input via `ant input` |
| `ant search` | **Evolved** | Now searches terminal output + messages |
| `ant delete` | **Kept** | Same |
| `ant archive` / `ant restore` | **Kept** | Same |
| `ant rename` | **Kept** | Same |
| `ant members` | **Kept** | Same |
| `ant filter` | **Kept** | Same |
| `ant exec` | **Evolved** | Sends command via AppleScript, waits for shell hook completion event |
| `ant attach` | **Replaced** | Becomes `ant focus` — brings Ghostty tab to front |
| `ant screen` | **Evolved** | Reconstructs screen from recent captured ANSI on demand |
| `ant health` | **Kept** | Same |
| `ant rooms` / `ant room` | **Kept** | Same |
| `ant room-tasks` / `ant room-tag` / `ant room-file` | **Kept** | Same |
| `ant input` | **New** | Send keystrokes to a terminal via AppleScript `input text` |
| `ant status` | **New** | Dashboard of all terminal states (idle/active/waiting/error) |
| `ant workflow` | **New** | Launch multi-terminal workflow templates |
| `ant session ensure` | **New** | Idempotent create-or-return |

### MCP Tools

| v2 Status | Notes |
|---|---|
| **Optional** | MCP becomes a thin wrapper calling `ant` CLI. All 40+ tools remain available but primary path is CLI. MCP kept for IDE integrations (VS Code, JetBrains) that expect MCP |

---

## 4. Core Systems

### 4.1 Terminal Orchestrator (AppleScript Bridge)

The Terminal Orchestrator manages Ghostty terminals via AppleScript on macOS. This is the only macOS-specific component — everything else is cross-platform.

**Capabilities:**

```applescript
-- Create a new terminal session
tell application "Ghostty"
    set cfg to new surface configuration
    set working directory of cfg to "/Users/me/project"
    set command of cfg to "/usr/local/bin/ant-capture abc123 /bin/zsh"
    set environment of cfg to {"ANT_SESSION_ID=abc123"}
    new tab with configuration cfg
end tell

-- Send input to a specific terminal
tell application "Ghostty"
    tell terminal id "xyz"
        input text "npm test" & return
    end tell
end tell

-- Query terminals by working directory
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

**Implementation:** `packages/daemon/terminal-orchestrator.ts`

```typescript
interface TerminalOrchestrator {
  create(opts: { name: string; cwd: string; command?: string; env?: Record<string, string> }): Promise<string>; // returns session ID
  input(sessionId: string, text: string): Promise<void>;
  sendKey(sessionId: string, key: 'enter' | 'tab' | 'ctrl+c' | 'ctrl+d' | ...): Promise<void>;
  focus(sessionId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
  listGhosttyTerminals(): Promise<Array<{ id: string; cwd: string; title: string }>>;
}
```

Every `create()` wraps the user's shell with `ant-capture <session-id>`, which:
1. Writes session metadata to `.meta` file
2. Injects shell integration hooks via BASH_ENV (bash) or ZDOTDIR override (zsh)
3. Execs `script -q -F <logfile>` to transparently tee all I/O
4. Exports `ANT_SESSION_ID` so hooks can correlate events

### 4.2 Capture System

**Already built as POC** in `packages/capture/`. Three components:

#### ant-capture (bash wrapper)
- Wraps any command with Unix `script` for transparent I/O capture
- Writes `.log` (raw terminal bytes), `.events` (NDJSON from shell hooks), `.meta` (session JSON)
- macOS: `script -q -F <logfile> <command>`
- Linux: `script -q -f <logfile> -c "<command>"`
- Shell detection: auto-injects hooks for bash (via BASH_ENV) or zsh (via ZDOTDIR)

#### Shell Integration Hooks (bash + zsh)
- **precmd/preexec hooks** emit OSC 133 prompt markers (A/C/D) for terminal-native command detection
- **NDJSON events** written to `.events` file: `command_start` (command text, CWD, timestamp) and `command_end` (exit code, duration_ms, CWD)
- Timestamp in milliseconds for precise duration tracking
- JSON escaping via python3 (bash) or native zsh quoting

#### CaptureIngest (TypeScript, runs in antd)
- Polls `.log` and `.events` files every 500ms
- Stores raw output in `terminal_output_events` as 4KB chunks
- Parses NDJSON events into `command_events` table
- Cursor-based: tracks bytes read per session in `capture_cursors` table
- Detects file truncation (cursor > file size) and resets
- Watches capture directory for new sessions
- Resilient: if antd restarts, picks up from stored cursor position

**The critical insight:** The capture system writes to local files. Nothing depends on antd being alive. The agent runs in Ghostty, `script` captures to disk, and antd catches up whenever it's available. This is stronger than dtach because the agent process doesn't even know ANT exists.

### 4.3 Message Router (replaces Chairman + Message Bridge)

Unified service replacing two v1 components that had overlapping concerns:

| v1 | Problem | v2 |
|---|---|---|
| Chairman | Polls conversations, LLM-based task detection, routes to agents | Message Router: event-driven subscription, same LLM capabilities |
| Message Bridge | Polls terminal output for ANTchat! commands, injects @mentions | Message Router: watches .events files, delivers via pub/sub with ACK |

**Key improvements over v1:**

1. **Event-driven, not polling** — subscribes to message and capture event streams
2. **Pub/sub with ACKs** — knows when a message was delivered and read, not fire-and-forget
3. **Single routing service** — one place for all message routing logic
4. **Audit trail** — every routing decision is a first-class record
5. **Per-conversation rules** — "backend tasks → Claude, frontend → Cursor agent"
6. **Stale detection** — same timer logic from v1 Chairman (3min assigned, 8min in-progress)

**Routing flow:**
```
Message arrives (from UI, CLI, terminal hook, or bridge)
  → Message Router evaluates:
    1. Is this an @mention? → Route to mentioned agent's terminal
    2. Is this a task? → LLM analysis → route to best-matching agent by capability
    3. Is this a room broadcast? → Deliver to all participants
    4. Is this a cross-session reference? → FTS5 query, attach context
  → Delivery via:
    - Terminal: AppleScript `input text` (with lock check)
    - Web UI: WebSocket push
    - Bridge: Platform adapter (Telegram, etc.)
  → Track: delivered → read → ACKed
```

### 4.4 Session State

ANT tracks per-terminal state assembled from multiple sources:

| State | Source | Update Frequency |
|---|---|---|
| CWD | Shell hook events (OSC 7 / NDJSON `cwd` field) | Every command |
| Status (idle/active/waiting/error) | Shell hooks: command_start → active, command_end → idle. Pattern matching on captured output for "waiting for input" | Real-time |
| Last command + exit code | Shell hook command_end event | Every command |
| Agent identity | Set at session creation, stored in session metadata | Once |
| Session metadata | `.meta` file written by ant-capture | Once |
| Terminal dimensions | Ghostty AppleScript query (when needed) | On demand |

### 4.5 Cross-Terminal Workflows

The unique capability no competitor has:

**Workflow Templates:**
```json
{
  "name": "full-stack-feature",
  "description": "Launch backend + frontend + test watcher for a feature",
  "terminals": [
    { "name": "backend", "cwd": "~/project/api", "suggested": "claude code" },
    { "name": "frontend", "cwd": "~/project/web", "suggested": "cursor agent" },
    { "name": "tests", "cwd": "~/project", "command": "npm test -- --watch" }
  ],
  "dependencies": [
    { "from": "backend", "to": "tests", "on": "command_end" }
  ]
}
```

**Status Dashboard:**
```
┌──────────────────────────────────────────────────────┐
│  Workflow: full-stack-feature                         │
│                                                      │
│  [●] backend  — active — claude code                 │
│      CWD: ~/project/api                              │
│      Last: npm test (exit 0, 3.2s ago)               │
│                                                      │
│  [●] frontend — idle — cursor agent                  │
│      CWD: ~/project/web                              │
│      Last: npm run build (exit 0, 12s ago)           │
│                                                      │
│  [○] tests    — waiting — npm test --watch           │
│      CWD: ~/project                                  │
│      Watching for changes...                         │
└──────────────────────────────────────────────────────┘
```

**Cross-Session Intelligence:**

When a user asks "did another agent try this?", ANT can answer because it has:
- Full-text search across all terminal output (command_events_fts)
- Command history with exit codes across all sessions
- Knowledge facts and error patterns linked across sessions

Example query flow:
```
User: "yo, I think Gemini tried that but Claude solved it — check sessions X and Y"
  → FTS5 search across terminal output for both sessions
  → Return matching command blocks with context
  → Surface in conversation with links to specific timestamps
```

---

## 5. Database Schema

SQLite WAL, same as v1. All existing tables **kept** unless noted. Key changes:

### Tables Kept As-Is (from v1)

These tables carry forward unchanged:

- `sessions` — terminal, conversation, unified types with TTL/workspace
- `messages` — role, format, metadata, sender identity, threading, starring
- `terminal_output_events` — chunked output (now fed by CaptureIngest instead of Socket.IO)
- `resume_commands` — command history for re-execution
- `workspaces` — session grouping
- `server_state` — key-value settings
- `bridge_mappings` — external platform channel links
- `antchat_rooms` — chat room registry
- `conversation_members` — agent-session relationships
- `terminal_locks` — exclusive access control
- `dangerous_commands` — safety patterns with severity
- `agent_registry` — model capabilities, context window, status
- `knowledge_facts` — atomic facts with scope, confidence, evidence
- `error_patterns` — failed commands linked to fixes
- `knowledge_links` — cross-references between sessions/facts/commands
- `session_digests` — LLM summaries before deletion
- `recipes` — reusable workflows with params
- `coordination_events` — task delegation with capability matching
- `session_permissions` — per-agent ACLs
- `session_terminals` — session-to-terminal links (1:many)
- `connected_devices` — multi-device tracking
- `user_preferences` — settings with confidence scores
- `common_calls` — quick command snippets
- `tasks` — shared task board
- `messages_fts` — FTS5 on messages
- `knowledge_facts_fts` — FTS5 on facts
- `session_digests_fts` — FTS5 on digests

### Tables Modified

```sql
-- command_events: extended with capture-specific columns (already in POC)
ALTER TABLE command_events ADD COLUMN start_chunk INTEGER DEFAULT NULL;
ALTER TABLE command_events ADD COLUMN end_chunk INTEGER DEFAULT NULL;

-- FTS5 external content table (avoids data duplication)
CREATE VIRTUAL TABLE IF NOT EXISTS command_events_fts USING fts5(
  command, output,
  content=command_events, content_rowid=rowid
);
```

### Tables Added

```sql
-- Capture cursor tracking (already in POC)
CREATE TABLE IF NOT EXISTS capture_cursors (
  session_id TEXT PRIMARY KEY,
  log_offset INTEGER NOT NULL DEFAULT 0,
  event_offset INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Message routing audit trail (new for Message Router)
CREATE TABLE IF NOT EXISTS routing_events (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  action TEXT NOT NULL,          -- 'route', 'deliver', 'ack', 'timeout', 'reroute'
  target_session_id TEXT,
  target_agent TEXT,
  decision_reason TEXT,          -- why this routing was chosen
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

-- Workflow templates (new for cross-terminal workflows)
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  template JSON NOT NULL,        -- terminals, dependencies, params
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Workflow instances (running workflows)
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',  -- running, completed, failed, cancelled
  params JSON,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);
```

### Tables Removed

None. All v1 tables are preserved for backward compatibility and data continuity.

---

## 6. CLI Design

The `ant` CLI is the primary interface for both humans and AI agents. Every command supports `--json` for machine consumption.

### Transport

```
Local:  ant CLI → UDS ($XDG_RUNTIME_DIR/ant/antd.sock) → antd
Remote: ant CLI → HTTP/WS (same API) → antd
```

Daemon auto-starts on first CLI invocation if not running (like tmux server).

### Command Reference

```bash
# ── Session Management ──
ant ls                                    # List tracked sessions
ant ls --workspace backend --json         # Filter + JSON output
ant create "my-agent" --cwd ~/project     # Create Ghostty tab with ant-capture
ant create "watcher" --cmd "npm test -w"  # Create with initial command
ant session ensure "backend"              # Idempotent create-or-return
ant focus "backend"                       # Bring Ghostty tab to front
ant close "backend"                       # Close Ghostty tab
ant status                                # Dashboard of all terminal states
ant rename "old" "new"                    # Rename session
ant archive "backend"                     # Archive session
ant restore "backend"                     # Restore archived session
ant delete "backend"                      # Permanent delete

# ── Terminal I/O ──
ant input "backend" "npm test"            # Send text to terminal via AppleScript
ant input "backend" --key ctrl+c          # Send key sequence
ant exec "backend" "npm test" --json      # Send command, wait for completion event
                                          # → {"command":"npm test","exit_code":0,"duration_ms":3200,"output":"..."}
ant read "backend" --follow               # Stream captured output
ant read "backend" --since 5m --plain     # Recent output, ANSI stripped
ant screen "backend" --json               # Reconstruct current screen from recent capture

# ── Messaging ──
ant msg send "backend" "run the tests"    # Post to conversation
ant msg list "backend" --since 1h         # Query history
ant msg reply <msg-id> "looks good"       # Thread reply
ant msg search "auth module"              # FTS5 across all sessions + terminal output

# ── Chat Rooms ──
ant rooms                                 # List rooms
ant room "my-room"                        # Room details
ant room-tasks "my-room" --status todo    # Filter tasks

# ── Workflows ──
ant workflow list                         # List templates
ant workflow start "full-stack"           # Launch multi-terminal workflow
ant workflow status                       # Running workflow states

# ── Knowledge ──
ant facts query "auth"                    # Search knowledge facts
ant facts add "JWT expired" --scope global  # Record fact

# ── System ──
ant health                                # Daemon connectivity check
ant daemon start                          # Explicit daemon start
ant daemon stop                           # Stop daemon
```

### The Two Primitives AI Agents Need

```bash
# Execute a command and get structured output
ant exec <session> <cmd> --json
# → {"command":"npm test","exit_code":0,"duration_ms":3200,"output":"..."}

# Get current terminal screen state
ant screen <session> --json
# → {"lines":["$ npm test","PASS src/auth.test.ts","Tests: 5 passed"],"cursor_row":3}
```

These work identically whether called by a human or by an LLM's Bash tool.

---

## 7. Web UI

React 19 + Zustand. Same frontend framework as v1 — no reason to change.

### What Changes

The biggest UI change: **TerminalViewV2 (xterm.js live terminal) becomes Terminal Dashboard (command blocks + status).**

The user interacts with the actual terminal in Ghostty. The web UI shows:

1. **Conversation View** — messages, threads, @mentions, task board (same as v1, with nested threading)
2. **Terminal Dashboard** — per-terminal command blocks with:
   - Command text + exit code (green/red indicator)
   - Duration
   - CWD at execution time
   - Expandable output (captured text, not live terminal)
   - Copy/search/share actions per block
   - Terminal status: idle / active / waiting-for-input / error
3. **Cross-Terminal Workflow View** — multi-agent status dashboard, dependency graph, parallel stream visualization
4. **Search** — FTS5 across messages AND terminal output, with results linking to specific command blocks

### Mobile Experience (via Tailscale)

The web UI is optimized for mobile access:

- **Buttery smooth scrolling** — it's rendered text in a web page, not a terminal buffer. No xterm.js viewport limitations
- **Full conversation history** — when Claude compacts at 2am, wake up, open ANT on your phone, everything is there
- **Quick input** — tap to send text/commands to any terminal via AppleScript
- **Status at a glance** — which agents are active, which are stuck, which finished
- **Search** — find that command from yesterday across all sessions

### Components Unchanged from v1

Sidebar, MessageList, InputArea, SearchPanel, TaskPanel, KnowledgePanel, CommonCallsPanel, ChatRoomPanel, SettingsModal, QuickSwitcher, MobileTabBar, StatusBar, OfflineOverlay, SessionRating, SenderAvatar, TerminalApprovalCard, ResumeDropdown.

### New Components

- **TerminalDashboard** — replaces TerminalViewV2. Command blocks, status, CWD
- **CommandBlock** — individual command + output with metadata and actions
- **WorkflowView** — multi-terminal status dashboard
- **WorkflowGraph** — dependency visualization between terminals
- **NestedThread** — tree rendering with collapse/expand for deep threads

---

## 8. Knowledge Pipeline

Sessions → Archive → Process → Obsidian Vault.

```
Active Session → ant-capture (live I/O) → SQLite (permanent storage)
                                              ↓
                                    Archive trigger (manual or TTL)
                                              ↓
                                    Processing pipeline:
                                    1. Extract command blocks with exit codes
                                    2. Summarize key decisions/outcomes (LLM)
                                    3. Extract code snippets & diffs
                                    4. Tag with project/topic metadata
                                              ↓
                                    Export to Obsidian vault:
                                    - Session summary note
                                    - Linked command block notes
                                    - Tagged with [[project]], [[agent]], [[date]]
                                    - Wikilinks to related sessions
```

### Obsidian Export Format

```markdown
# Session: refactor-agent (2026-04-03)

**Agent:** GPT-OSS | **Duration:** 2h 14m | **Commands:** 47 | **Exit codes:** 43 ok, 4 failed

## Summary
Refactored auth module from JWT to session-based auth. Hit a circular dependency
in middleware (failed 3 times) before resolving via lazy imports.

## Key Decisions
- Chose session-based over OAuth2 (agent reasoned about simplicity)
- Used lazy imports to break circular dependency (command block #34)

## Notable Commands
- `npm test -- --grep auth` → 12 runs, first 3 failed
- `git diff HEAD~5` → shows the full scope of changes

## Linked Sessions
- [[session-claude-backend-2026-04-02]] — earlier attempt at same refactor
- [[session-gemini-tests-2026-04-03]] — test suite improvements that enabled this

## Tags
#project/myapp #agent/gpt-oss #topic/auth #topic/refactoring
```

### How Knowledge Compounds

1. Every session builds the vault
2. Future sessions can reference vault notes (via RAG or manual lookup)
3. Error patterns from one agent inform another (via `error_patterns` table + FTS5)
4. Session digests survive even after raw data is archived/purged
5. The vault is the user's permanent, portable knowledge base — independent of ANT

### v1 Features Preserved

- `session_digests` table — LLM summaries before deletion
- `knowledge_facts` — atomic facts with scope and confidence
- `error_patterns` — failed commands linked to fixes with success rates
- `knowledge_links` — cross-references
- Obsidian vault export (already in v1 via `/api/store`)

---

## 9. Platform Strategy

| Platform | Terminal Backend | Control Method | I/O Capture | Status |
|---|---|---|---|---|
| **macOS** | Ghostty | AppleScript (create, input, focus, query) | ant-capture + `script -q -F` | **Primary target** |
| **macOS (degraded)** | Any terminal | No orchestration (user launches manually) | ant-capture if user wraps shell | Supported |
| **Linux** | Ghostty | D-Bus / libghostty (when available) | ant-capture + `script -q -f` | **Future** |
| **Linux (fallback)** | Any terminal | No orchestration | ant-capture if user wraps shell | Supported |
| **Remote/headless** | N/A | N/A | ant-capture in SSH session | Supported |

### macOS-First Rationale

- Ghostty's AppleScript API provides create/input/focus/query — exactly what ANT needs
- AppleScript is a stable, mature interface (decades old)
- Ghostty is MIT-licensed, free, increasingly popular (49K+ stars)
- The primary user base (developers using LLM CLI tools) skews heavily macOS
- Linux support comes later via D-Bus or libghostty cross-platform API

### What Works Without Ghostty

Even without Ghostty/AppleScript orchestration, these features still work:
- All messaging and conversation features
- Knowledge system
- Search across sessions
- Task board, coordination, recipes
- Web UI (conversation view, search, knowledge)
- Bridge integrations (Telegram, etc.)
- I/O capture (if user manually wraps shell with ant-capture)

What requires Ghostty on macOS:
- `ant create` (auto-creating terminal tabs)
- `ant input` / `ant exec` (sending commands to terminals)
- `ant focus` (bringing terminals to front)
- Automatic ant-capture wrapping at session creation

---

## 10. What Gets Deleted

The paradigm shift from "ANT is a terminal" to "ANT is an orchestration layer" eliminates significant complexity:

| Component | Size/Complexity | Why It's Removed |
|---|---|---|
| `node-pty` | Native addon, node-gyp builds | Ghostty manages PTYs natively |
| `xterm.js` + all addons | ~200KB JS + WebGL/unicode/fit/serialize/web-links | Ghostty renders natively. Web UI shows captured text, not a live terminal |
| `@xterm/headless` | Server-side terminal emulation | Not needed — ANT captures raw I/O, doesn't mirror terminal state |
| `HeadlessTerminalWrapper` | Complex state machine | Replaced by shell hook events (3 lines of bash) |
| `SerializeAddon` | Terminal state serialization | No terminal state to serialize |
| `TerminalViewV2.tsx` | 32KB React component | Replaced by TerminalDashboard (command blocks, not live terminal) |
| `terminal-namespace.ts` | Socket.IO binary PTY relay | No PTY data flowing through ANT |
| `dtach` integration | Session persistence layer | Ghostty tabs persist independently |
| WebGL addon | GPU rendering in browser | Native GPU rendering in Ghostty |
| `CommandTracker` quiet-period heuristic | Fragile timing-based detection | Replaced by precise shell hook events |
| Chairman polling loop | Interval-based message scanning | Replaced by event-driven Message Router |
| Message Bridge polling loop | Interval-based terminal output scanning | Same — event-driven |

### What This Eliminates

- **node-gyp build failures** — the #1 installation friction
- **WebGL context limits** — browsers limit WebGL contexts, breaking multi-terminal views
- **Binary Socket.IO relay** — complex, fragile, high bandwidth
- **Headless terminal state drift** — server mirror getting out of sync with actual terminal
- **Two polling loops** (Chairman + Bridge) doing overlapping work
- **5-hop latency** for agent interactions (now 2 hops)

### Lines of Code Removed (Estimated)

- node-pty + xterm.js integration: ~3,000 lines
- HeadlessTerminalWrapper + CommandTracker: ~1,500 lines
- Terminal Socket.IO namespace: ~800 lines
- TerminalViewV2: ~1,000 lines
- Chairman + Bridge polling: ~1,200 lines
- **Total: ~7,500 lines removed**

### Lines of Code Added (Estimated)

- Terminal Orchestrator (AppleScript bridge): ~400 lines
- ant-capture + shell hooks: ~300 lines (already built)
- CaptureIngest: ~300 lines (already built)
- Message Router: ~800 lines
- TerminalDashboard + CommandBlock components: ~600 lines
- UDS transport for CLI: ~200 lines
- **Total: ~2,600 lines added**

**Net reduction: ~5,000 lines.** Simpler, more reliable, fewer moving parts.

---

## 11. Phased Build Plan

### Phase 1: Daemon + UDS (Week 1-2)

Extract antd as a standalone daemon process. **Detailed 12-step migration sequence:**

**Pre-conditions before Step 10 (app thinning):**
1. `VITE_ANT_DAEMON_URL` env var — React `store.ts` must be configurable for daemon on separate port
2. `DbChatRoomRegistry` singleton — create once in daemon entry point, pass to Chair and routes (currently two separate instances)
3. Replace self-fetch calls in `terminal-monitor.ts` and `task-watchdog.ts` with direct DB inserts + `io.emit()` to eliminate startup ordering hazards
4. Fix ESM bug in `capture-ingest.ts` — lines 198–201 use `require("fs")` inside an ESM module; fix to top-level imports

**Steps:**
- [x] **Step 1** — Scaffold `packages/daemon/` (entry point, UDS server, PID management, logger) ✅
- [x] **Step 1b** — CLI: `uds-client.ts`, `ant daemon start|stop|status|restart`, `--json` already implemented ✅
- [ ] **Step 2** — Move `db.ts` + `types.ts` to daemon; add `ANT_DB_PATH` env var; add `capture_cursors` table
- [ ] **Step 3** — Move `feature-flags.ts`, `constants.ts`, `middleware/auth.ts`, `middleware/localhost.ts`
- [ ] **Step 4** — Move `terminal/headless-terminal.ts`, `terminal/command-tracker.ts`, `pty-manager.ts`
- [ ] **Step 5** — Move Chair subsystem: `db-chat-room-registry.ts`, `message-bridge.ts`, `task-watchdog.ts`, `terminal-monitor.ts`, `chairman-bridge.ts` → rename to `chair.ts`; fix self-fetch; create singleton registry
- [ ] **Step 6** — Move `retention.ts`, `capture-ingest.ts` (fix ESM bug during move)
- [ ] **Step 7** — Move all 20 route files from `server/routes/` → `daemon/src/routes/`; rename `routes/chairman.ts` → `routes/chair.ts`
- [ ] **Step 8** — Move WS handlers: `ws/handlers.ts`, `ws/terminal-namespace.ts`, `ws/chat-handlers.ts`
- [ ] **Step 9** — Create full `daemon/src/index.ts`: Express + Socket.IO + all routes + WS + Chair/retention start + heartbeat
- [ ] **Step 10** — Thin `packages/app/server/index.ts` to ~30 lines: serve Vite/static only; add `VITE_ANT_DAEMON_URL` support
- [ ] **Step 11** — Create `packages/shared/src/events.ts`: typed Socket.IO event contract imported by both daemon and app
- [ ] **Step 12** — Delete dead code from `packages/app/server/`: `db.ts`, `pty-manager.ts`, `terminal/`, `chairman-bridge.ts`, all route files

**Key decisions from analysis:**
- Daemon owns **all** tables. App never touches SQLite directly. `better-sqlite3` is a daemon-only dependency.
- `stripAnsi()` stays in daemon types unless app needs it — if so, promote to `packages/shared/`.
- Replace `Chairman`/`chairman` naming throughout with `Chair`/`chair` during Steps 5 and 7.
- Socket path: `process.env.ANT_SOCKET ?? os.tmpdir() + '/ant/antd.sock'`

**Why first:** This is the foundation everything else builds on. The daemon owns state.

### Phase 2: Capture System (Week 2-3)

Integrate the POC capture system into antd:
- [ ] Move `packages/capture/` into daemon
- [ ] Wire CaptureIngest into daemon startup
- [ ] Verify cursor-based catch-up after daemon restart
- [ ] Add FTS5 indexing on ingested command events
- [ ] Test with long-running sessions (hours of capture)
- [ ] Add `ant read` support for captured output (streamed from SQLite)
- [ ] Add `ant screen` reconstruction from recent captured ANSI

**Why second:** Capture is the core value. Must be solid before building on it.

### Phase 3: Ghostty Integration (Week 3-4)

Build the Terminal Orchestrator:
- [ ] Create `terminal-orchestrator.ts` with AppleScript bridge
- [ ] Implement: create, input, sendKey, focus, close, listTerminals
- [ ] `ant create` creates Ghostty tab with ant-capture wrapper
- [ ] `ant input` sends text via AppleScript `input text`
- [ ] `ant exec` sends command + waits for shell hook completion event
- [ ] `ant focus` brings terminal to front
- [ ] `ant close` closes terminal
- [ ] Handle Ghostty not installed (clear error message)

**Why third:** Once daemon + capture work, adding Ghostty control is the natural next step.

### Phase 4: Message Router (Week 4-5)

Replace Chairman + Message Bridge:
- [ ] Build unified Message Router in daemon
- [ ] Event-driven subscription to message and capture streams
- [ ] @mention detection and routing
- [ ] LLM-based task detection (same prompts as v1 Chairman)
- [ ] Pub/sub delivery with ACKs
- [ ] Routing audit trail (routing_events table)
- [ ] Per-conversation routing rules
- [ ] Stale task detection (same timers as v1)
- [ ] Remove Chairman polling loop
- [ ] Remove Message Bridge polling loop

**Why fourth:** The existing Chairman/Bridge still work during phases 1-3.

### Phase 5: Web UI Overhaul (Week 5-7)

Replace terminal rendering with Terminal Dashboard:
- [ ] Build TerminalDashboard component (command blocks, status, CWD)
- [ ] Build CommandBlock component (command + output + metadata)
- [ ] Remove TerminalViewV2 and xterm.js dependency
- [ ] Remove node-pty, headless terminal, serialize addon
- [ ] Remove Socket.IO terminal namespace (binary PTY relay)
- [ ] Add Cross-Terminal Workflow View
- [ ] Add nested threading to ChatThread
- [ ] Extend SearchPanel to search terminal output
- [ ] Mobile optimization for Tailscale access
- [ ] Verify buttery smooth scrolling on mobile (it's just text now)

**Why fifth:** The conversation UI works fine during earlier phases. Terminal view is the big change.

### Phase 6: Workflows + Knowledge Pipeline (Week 7-9)

Cross-terminal workflows and Obsidian export:
- [ ] Workflow template storage and CLI commands
- [ ] Multi-terminal launch from templates
- [ ] Status aggregation dashboard
- [ ] Dependency tracking between terminals
- [ ] Knowledge pipeline: archive → process → Obsidian export
- [ ] Obsidian note format with wikilinks, tags, summaries
- [ ] Asciicast v3 session recording export

**Why last:** These are value multipliers that build on everything else being solid.

### Phase 7: Cleanup + Polish

- [ ] Remove all dead code from phases 1-6
- [ ] Performance testing (100+ sessions, hours of capture data)
- [ ] Documentation
- [ ] Error handling and edge cases
- [ ] Bridge adapter updates (connect to daemon instead of Express)

---

## 12. Risk Analysis

### Technical Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Ghostty AppleScript API changes** | Medium | Pin to Ghostty version. AppleScript APIs are historically stable. Monitor Ghostty releases |
| **Ghostty not installed** | Low | Clear error on `ant create`. All non-orchestration features still work |
| **`script` command differences** | Low | Already handled: macOS `script -q -F` vs Linux `script -q -f -c`. Tested in POC |
| **Capture file growth** | Medium | Implement rotation/archival. Large sessions (days) could produce GB of logs. Archive after session ends, keep SQLite chunks |
| **Shell integration breaking user config** | Medium | Same approach as Ghostty/Kitty: override env vars only, never modify dotfiles. Detect nested sessions (tmux/zellij) and skip injection |
| **UDS permissions** | Low | Standard Unix socket permissions. $XDG_RUNTIME_DIR is user-owned |
| **SQLite lock contention** | Low | WAL mode handles concurrent reads. Single writer (antd). Proven in v1 |
| **CaptureIngest polling overhead** | Low | 500ms interval is negligible. `statSync` on a few files costs microseconds |

### Product Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **"Split attention" UX** | Medium | This is the design, not a bug. Ghostty for typing, ANT web UI for reviewing/searching/mobile. Same model as Slack alongside your IDE |
| **macOS-only orchestration** | High | Accept for now. Linux users get degraded mode (capture works, orchestration doesn't). Plan D-Bus support when Ghostty adds it |
| **Ghostty dependency** | Medium | Ghostty is MIT, free, 49K+ stars, actively developed. Reasonable to require for premium experience. Degraded mode without it |
| **User must install Ghostty** | Low | One-time setup. Ghostty has brew/dmg installers. Clear onboarding docs |

### Migration Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Data loss during migration** | High | SQLite database carries forward unchanged. No table drops. New tables added alongside |
| **v1 features regressing** | Medium | Feature migration map (Section 3) ensures nothing is lost. Each phase has explicit "what still works" criteria |
| **MCP integrations breaking** | Medium | Keep MCP as thin CLI wrapper during transition. Same tool names, same schemas |

---

## 13. Decisions (formerly Open Questions)

All questions resolved 2026-04-03.

| # | Question | Decision |
|---|---|---|
| 1 | Screen reconstruction | **Command blocks only by default.** Pulsing activity indicator on terminal tab shows live activity. No partial output streaming to UI. **Smooth view toggle** (like slow edit) spins up xterm.js on-demand for that terminal only — lazy-loaded, not in bundle by default. |
| 2 | Fish shell | **Bash + zsh now. Fish later.** Hook mechanism is different enough to do properly; not blocking anyone today. |
| 3 | Capture timing | **Shell hook timestamps only.** `script -t` replay is a future nice-to-have — not worth the complexity now. |
| 4 | Notification triggers | **Waiting for input + @mention only.** Low cadence by design. Errors, idle, completion show in UI passively — no push. |
| 5 | Session naming | **Auto-generate always, user can override.** No friction at creation time. |
| 6 | Chat scope | **All Chats are accessible to all Terminals. Chair monitors everything.** Chats are not scoped to individual terminals — they are a shared layer above all of them. |
| 7 | Daemon process model | **Single-threaded Node.js to start.** CaptureIngest is I/O-bound polling — negligible overhead. Design CaptureIngest stateless so worker threads can be added later without rearchitecting. |
| 8 | Web UI framework | **Stay React 19 + Zustand for the rewrite. Switch to Svelte 5 at Phase 5** (UI overhaul) — Phase 5 replaces the frontend anyway, so the switch happens at a natural seam rather than mid-rewrite. |
| 9 | Asciicast export | **Custom exporter, ~100 lines.** All data needed (timestamps from shell hooks, raw output from ant-capture) is already owned. No external dependency needed. |

---

## Appendix: Research Documents

All research that informed this document is in `docs/research/`:

| File | Content |
|---|---|
| `00-ANT-v2-architecture-research-synthesis.md` | Main research synthesis — rendering, shell integration, CLI architecture, competitive positioning |
| `01-session-capture-state-detection-raw.md` | OSC sequences, shell integration protocols, PTY state monitoring |
| `02-warp-modern-terminals-raw.md` | Warp, Ghostty, WezTerm, Kitty, Zellij, Rio, Wave evaluation |
| `03-terminal-io-capture-storage-raw.md` | I/O capture, structured storage, command boundaries |
| `04-cli-architecture-raw.md` | Daemon design, IPC patterns, MCP vs CLI |
| `05-competitive-landscape-raw.md` | Claude Code, Cursor, Warp, Zed, Wave, emerging patterns |
| `06-cli-vs-mcp-credibility-analysis.md` | Source verification for CLI vs MCP reliability stats |
| `07-messaging-architecture-analysis.md` | Message flow, threading, Chairman, Bridge analysis |
| `08-ghostty-web-addon-compatibility.md` | Addon compatibility for ghostty-web (blockers identified) |
| `09-warp-api-corrected.md` | Warp Oz API, CLI, OSC 777, URI scheme |
| `10-orchestration-layer-architecture.md` | The vision document — ANT as orchestration layer above Ghostty |

## Appendix: Working POC Code

The capture system has a working proof of concept in `packages/capture/`:

| File | Description |
|---|---|
| `ant-capture` | Bash wrapper using `script` for transparent I/O capture |
| `shell-integration/ant.bash` | Bash precmd/preexec hooks emitting OSC 133 + NDJSON |
| `shell-integration/ant.zsh` | Zsh equivalent using native add-zsh-hook |
| `capture-ingest.ts` | TypeScript class polling .log/.events files into SQLite |
| `test-capture.sh` | Smoke test (passing) |

---

*This document is the definitive build plan for ANT v2. Every v1 feature is accounted for in Section 3. The phased plan in Section 11 can be executed sequentially — each phase produces a working system.*
