# ANT — A Nice Terminal

[![CI](https://github.com/Jktfe/a-nice-terminal/actions/workflows/ci.yml/badge.svg)](https://github.com/Jktfe/a-nice-terminal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-20.19.4-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-1.3.13-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white)](https://kit.svelte.dev/)

**The missing layer between "I have 13 AI CLIs" and "they actually work together."**

ANT is a self-hosted agent orchestrator that coordinates multiple AI CLI tools (Claude Code, Gemini CLI, Codex, Copilot, Qwen, Pi, Hermes, Ollama, and more) through shared terminal sessions, persistent chat, and a convention-based coordination protocol — without requiring MCP servers, custom plugins, or framework lock-in.

## Why ANT?

Most AI coding tools run in isolation. You can't easily have Claude Code review what Gemini wrote, or delegate a task from one agent to another. ANT solves this by treating terminal I/O, chat, memory, and task delegation as one shared substrate.

**ANT is not a terminal multiplexer.** tmux and Zellij manage terminal panes. ANT manages *agents* — it knows who's connected, what they can do, and how to route messages between them.

### What makes it different

- **Convention over framework** — agents coordinate via shared SQLite key-value conventions (`tasks/`, `agents/`, `goals/`), not MCP tool definitions or API contracts
- **Agent fingerprinting** — automated probe pipeline detects how each CLI handles interactive prompts and generates normalised drivers (see [Agent Fingerprinting](#agent-fingerprinting) below)
- **Task delegation protocol** — explicit `todo → doing → review → done` state machine with mandatory separate verifier
- **Linked-chat bridge** — terminal output surfaces as chat bubbles; chat messages auto-forward as keystrokes to answer interactive prompts
- **Zero sidecar overhead** — no MCP server per agent, no framework runtime, just SQLite + PTY streams
- **Radically lower token cost** — no MCP tool schemas injected per request, no polling loops, no system prompt bloat. Messages are plain text via PTY injection. Coordination overhead is a fraction of total spend — the vast majority of tokens go to actual work, not framework tax
- **Local + cloud in the same session** — Ollama and LM Studio agents work identically to cloud agents (same PTY injection, same @mentions, same task delegation). Offload mechanical work to free local models, save API spend for agents that need reasoning
- **Lessons learned** — see [docs/LESSONS.md](docs/LESSONS.md) for the design decisions, transferable insights, and commit-cited regressions that produced the substrate above

## Features

- **Live terminal sessions** — full PTY streaming via WebSocket and xterm.js
- **Rich ANT Terminal** — readable command blocks projected from append-only `run_events`, with a one-click Raw Terminal escape hatch
- **Plan View** — live, provenance-backed milestone and acceptance-test view over the same event log
- **Persistent chat** — message threads with FTS5 full-text search (trigram tokeniser for code-friendly matching)
- **Multi-agent coordination** — agent registry, @mention routing, task delegation, shared memory
- **Mobile-friendly controls** — pinned terminals, searchable CLI picker, folder drawer, file/reference panel, and Add Terminal shortcut
- **Structured agent adapters** — Pi RPC and Hermes ACP project trusted JSON/ACP streams into the same event model as terminal capture
- **CLI tool** (`ant`) — full session management, chat, tasks, memory, and agent control from anywhere
- **Trust-tier rendering** — raw bytes never render as rich content; medium events stay escaped; high-trust events can render controlled cards/images
- **Upload hardening** — authenticated, rate-limited, content-addressed uploads for chat/reference surfaces
- **API key auth + Tailscale gating** — restrict access to your private network
- **HTTPS/TLS** — self-signed cert support
- **Session recovery** — PTY daemon survives server restarts
- **launchd daemon** — persistent background service on macOS

## Architecture

```
Browser (Svelte 5 + xterm.js)
    ↕ WebSocket
Node.js HTTP/WS Server (SvelteKit + custom server.ts)
    ↕ Unix socket
PTY Daemon (node-pty, survives restarts)
    ↕
SQLite (WAL + FTS5, 15+ tables)
    ↕
CLI (ant) — Bun-native TypeScript
```

### Three-Tier Terminal Model

ANT exposes three views over the same terminal session:

- **Linked Chat is the navigator** — a private 1:1 companion chat for actionable messages, questions, approvals, decisions, and results.
- **ANT Terminal is the renderer** — a Svelte activity log built from append-only `run_events`, showing interpreted terminal progress, hook events, status changes, tool activity, and trust indicators as readable HTML.
- **Raw Terminal is the data pipe** — the xterm.js/tmux PTY ground truth, kept available as the faithful fallback when the interpreted view is wrong, incomplete, or the agent needs direct terminal control.

The trust hierarchy is explicit: structured hook/JSON events are highest trust, parsed terminal diffs are medium trust, and the raw tmux transcript remains the audit source.

## Quick Start

```bash
# Install the app dependencies
bun install

# Configure
cp .env.example .env
# Edit .env — at minimum set ANT_API_KEY (generate with: openssl rand -hex 32)

# Build and start. Build is side-effect free; start runs the server.
bun run build
bun run start
# Server runs at https://localhost:6458 (or http:// without TLS certs)

# Local convenience: rebuild then restart the local server process.
bun run restart:local
```

## CLI

The `ant` CLI is a standalone Bun-native tool that gives you full control over sessions, chat, tasks, memory, and agents from any terminal.

### Setup

```bash
cd cli && bun install && bun link

# Configure the CLI to point at your server
ant config set --url https://localhost:6458 --key YOUR_API_KEY
```

### Session Management

```bash
ant sessions                              # List all sessions
ant sessions create --name "Dev" --type terminal
ant sessions create --name "Chat" --type chat
ant sessions archive <id>                 # Archive a session
ant sessions delete <id>                  # Delete a session
ant sessions export <id>                  # Export to Obsidian vault
ant sessions export <id> --target all     # Export evidence to Obsidian, Open-Slide, and Osaurus
```

### Terminal

```bash
ant terminal <id>                         # Interactive PTY (full terminal)
ant terminal watch <id>                   # Read-only live stream
ant terminal send <id> --cmd "ls -la"    # One-shot command
ant terminal history <id>                 # Read persisted history
ant terminal key <id> ctrl-c              # Send special key
```

### Chat & Messaging

```bash
ant chat <id>                             # Interactive chat session
ant chat send <id> --msg "hello"         # Send a message
ant chat read <id> --limit 50            # Read message history
ant chat reply <id> --msg "yes"          # Reply to latest
ant msg <id> "broadcast to all"          # Broadcast to all participants
ant msg <id> @handle "direct message"    # Targeted message to one agent
```

### Task Delegation

```bash
ant task <id> list                        # List tasks
ant task <id> create "title" --desc "..."# Propose a task
ant task <id> accept <task-id>           # Accept a proposed task
ant task <id> assign <task-id> @handle   # Assign to an agent
ant task <id> review <task-id>           # Mark ready for review
ant task <id> done <task-id>             # Mark complete
```

### Memory (Mempalace)

```bash
ant memory get <key>                      # Read a memory entry
ant memory put <key> <value>             # Store a memory entry
ant memory list <prefix>                  # List by prefix (tasks/, agents/, goals/)
ant memory search <query>                 # FTS5 search across all memory
```

### Agent Registry

```bash
ant agents list                           # List registered agents with capabilities
```

### Other

```bash
ant search "query"                        # FTS5 full-text search across everything
ant flag <id> <file> --note "why"        # Flag a file reference in a session
ant qr <id>                               # Generate QR code for session sharing
```

## Agent Fingerprinting

ANT includes an automated probe pipeline that detects how different AI CLI tools handle interactive events — permission dialogs, multi-choice prompts, confirmations, progress indicators — and generates normalised driver specs for each one.

### How it works

1. **Probe harness** (`ant-probe/`) sends structured test cases (P01–P10) to each agent
2. **Capture daemon** records responses via tmux control-mode (100ms debounce)
3. **Runner** compares output against existing driver specs and generates diffs
4. **Drivers** implement the `AgentDriver` interface: `detect()`, `respond()`, `isSettled()`

### Running fingerprints

```bash
bun run fingerprint:claude                # Probe Claude Code
bun run fingerprint:gemini                # Probe Gemini CLI
bun run fingerprint:codex                 # Probe Codex CLI
bun run fingerprint:all                   # Probe all agents
bun run fingerprint:list                  # List available agents
```

### Supported Agents

| Agent | Tier | Status |
|-------|------|--------|
| Claude Code | 1 | Fully validated |
| Gemini CLI | 1 | Fully validated |
| Codex CLI | 1 | Fully validated |
| Pi coding agent | 1 | Structured RPC adapter |
| Hermes | 1 | Hermes ACP adapter |
| GitHub Copilot | 2 | Partially validated / hook-capable |
| Qwen CLI | 2 | Tmux/regex fallback |
| Perspective CLI | 2 | Experimental macOS driver |
| Ollama | 2 | Partially validated |
| LM Studio | 2 | Experimental |

## Multi-Agent Use Case

A typical multi-agent session in ANT:

1. **Create a shared chat session** — all agents join the same room
2. **Assign roles** — e.g. Claude owns security review, Codex owns tests, Copilot owns docs
3. **Delegate tasks** — use `ant task create` to propose work, agents accept and execute
4. **@mention routing** — `@claude` messages route to Claude's terminal, `@codex` to Codex's
5. **Review cycle** — tasks move through `todo → doing → review → done` with mandatory separate verifier
6. **Shared memory** — agents read/write to the mempalace (`tasks/`, `agents/`, `goals/` prefixes)

See [docs/multi-agent-protocol.md](docs/multi-agent-protocol.md) for the full coordination protocol.

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANT_API_KEY` | — | Bearer token for API/WS auth (generate with `openssl rand -hex 32`) |
| `ANT_PORT` | `6458` | Server port |
| `ANT_HOST` | `0.0.0.0` | Bind address |
| `ANT_TAILSCALE_ONLY` | `false` | Restrict to Tailscale 100.x.x.x IPs |
| `ANT_ALLOW_LOOPBACK` | `true` | Allow localhost connections |
| `ANT_TLS_CERT` | — | Path to TLS certificate |
| `ANT_TLS_KEY` | — | Path to TLS private key |
| `ANT_ROOT_DIR` | — | Root directory for project browsing |
| `ANT_OBSIDIAN_VAULT` | — | Obsidian vault path for session export |
| `ANT_OPEN_SLIDE_DIR` | `~/CascadeProjects/ANT-Open-Slide` | Local folder for generated Open-Slide evidence decks |
| `ANT_QUICK_LAUNCH_FILE` | `~/.ant/quick-launch.json` | Local-only terminal quick-launch button presets |
| `ANT_SERVER_URL` | — | Public URL for share commands and CLI instructions |

## Stack

- **Frontend**: Svelte 5 + SvelteKit + Tailwind CSS
- **Server**: Node.js custom HTTP/WebSocket server
- **Terminal**: node-pty → WebSocket → xterm.js (DOM renderer)
- **Database**: SQLite (better-sqlite3) with WAL mode + FTS5
- **CLI**: Bun-native TypeScript
- **Auth**: API key + Tailscale IP gating + same-origin browser bypass

## API

```
GET    /api/health
GET    /api/sessions
POST   /api/sessions
GET    /api/sessions/:id
PATCH  /api/sessions/:id
DELETE /api/sessions/:id
GET    /api/sessions/:id/messages
POST   /api/sessions/:id/messages
GET    /api/sessions/:id/share
POST   /api/sessions/:id/terminal/input
GET    /api/search?q=...
GET    /api/memories?q=...&limit=
POST   /api/memories
DELETE /api/memories?id=
GET    /api/workspaces
GET    /api/plan
GET    /api/sessions/:id/run-events
GET    /api/sessions/:id/file-refs
POST   /api/upload
WS     /ws
```

Authentication: `Authorization: Bearer <key>`, `X-API-Key: <key>`, or `?apiKey=<key>`.

## macOS Daemon

Copy `ant.server.plist.example` to `~/Library/LaunchAgents/ant.server.plist`, fill in your paths, then:

```bash
launchctl load ~/Library/LaunchAgents/ant.server.plist
```

## Development

```bash
bun run dev              # Vite dev server
bun run check            # svelte-check; must be 0 errors / 0 warnings
bun run test             # Unit tests
bun run test:integration # Live-server integration tests; set ANT_TEST_URL to enable
bun run build            # Production build; no server restart side effects
bun run verify           # check + unit tests + build
bun run test:watch       # Watch mode
```

CI mirrors production by running under Node 20.19.4. If native modules drift after using a different Node version in a worktree, rebuild with the same Node version used by launchd before restarting the service.

Integration tests are skipped unless `ANT_TEST_URL` points at a running server:

```bash
ANT_TEST_URL=https://your-ant-host.example:6458 bun run test:integration
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Please report security issues privately per [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE) — James King, 2026
