# ANT Setup Skill — Qwen Code CLI

This file tells Qwen Code CLI how to set up ANT (A Nice Terminal) on a new
machine and join a running coordination session. Read it once, follow the
steps, and you will be operational.

---

## What ANT is

ANT is a self-hosted coordination layer for AI agents. It runs real terminal
sessions, links them to chat rooms, routes prompts and approvals, and keeps a
searchable evidence trail. Multiple agents (Claude, Codex, Gemini, Copilot,
Qwen, Pi, local models) share the same ANT instance and coordinate via plain
text chat and a convention-based task protocol — no MCP servers or framework
lock-in required.

---

## Prerequisites

```bash
node --version   # must be 20 or newer
bun --version    # must be 1.1 or newer
git --version    # any recent version
```

Install missing tools:
- **Node.js 20+**: https://nodejs.org or `brew install node`
- **Bun 1.1+**: `curl -fsSL https://bun.sh/install | bash`

---

## Part 1 — Server setup (one machine per team)

Only one person runs the server. Skip to Part 2 if a teammate already has
ANT running.

```bash
git clone https://github.com/Jktfe/a-nice-terminal.git
cd a-nice-terminal
npm install
cp .env.example .env
```

Edit `.env` — the only required field is `ANT_API_KEY`:

```bash
openssl rand -hex 32   # generate a key, paste into .env as ANT_API_KEY=...
```

Optional but recommended: set `ANT_SERVER_URL` to your Tailscale hostname
(e.g. `https://my-machine.ts.net:6458`) for remote access.

Start the server:

```bash
npm run build && npm run start
# Server listens on https://localhost:6458 by default
```

Open `http://localhost:6458` to confirm it is running.

### Run as a persistent background service (macOS)

```bash
cp ant.server.plist.example ~/Library/LaunchAgents/dev.antonline.server.plist
# Edit the plist: set WorkingDirectory to the repo path and update the API key
launchctl load ~/Library/LaunchAgents/dev.antonline.server.plist
```

---

## Part 2 — CLI setup (every machine)

```bash
cd a-nice-terminal/cli
bun install
bun link

ant config set --url https://localhost:6458 --key YOUR_API_KEY
ant sessions   # should return a session list
```

---

## Part 3 — Qwen model setup

Qwen Code CLI can run against the Qwen API (cloud) or a locally-served model
via Ollama or LM Studio.

### Option A — Cloud API

```bash
# Install Qwen Code CLI (check official docs for latest install command)
npm install -g qwen-code   # or the current package name

# Set your API key
export QWEN_API_KEY=your-key-here
```

### Option B — Local via Ollama (no API cost, runs offline)

```bash
# Install Ollama: https://ollama.com
brew install ollama

# Pull a Qwen model (choose size that fits your RAM)
ollama pull qwen2.5-coder:7b    # ~4 GB — good for most tasks
ollama pull qwen2.5-coder:32b   # ~20 GB — higher quality

# Start Ollama server
ollama serve   # or it runs automatically on macOS after install
```

Qwen Code picks up Ollama automatically when `OLLAMA_HOST` is set or when
Ollama is running on the default port (11434).

---

## Part 4 — Qwen CLI behaviour in ANT

ANT's Qwen driver was fingerprinted against Qwen Code CLI v0.15.3.
Key characteristics:

- **TUI is very similar to Claude Code** — uses `✦` for responses, braille
  spinners (`⠼⠹`) for thinking, `╭╰` box drawing for tool results.
- **YOLO mode** — launch with `--yolo` to auto-execute shell commands and
  file edits without approval dialogs.
- **Status bar**: `YOLO mode (shift + tab to cycle)` when in auto-exec mode.
- **Prompt marker**: `>` prefix or `* Type your message or @path/to/file`.
- **Model display**: `API Key | qwen2.5-coder:7b (/model to change)`

### Launch Qwen inside an ANT terminal session

```bash
# 1. Create a terminal session
ant sessions create --name "myQwen" --type terminal --json

# 2. Navigate to your project
ant terminal send <terminal-id> --cmd "cd ~/path/to/project"

# 3. Launch Qwen in YOLO mode
ant terminal send <terminal-id> --cmd "qwen --yolo"
# For local Ollama model:
ant terminal send <terminal-id> --cmd "OLLAMA_HOST=localhost:11434 qwen --yolo --model qwen2.5-coder:7b"
```

### Add Qwen to a shared chatroom

```bash
curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \
  -H 'content-type: application/json' \
  --data '{"session_id":"<terminal-id>","role":"participant","alias":"@qwen"}'

ant chat send <room-id> --msg "@qwen please read the project README and let us know what you can help with."
```

---

## Part 5 — Qwen has no native hook system

Qwen Code CLI does not expose a hooks API. ANT relies on tmux terminal
fingerprinting (spinner patterns, prompt markers, tool result boxes) to track
Qwen state. For evidence after a task:

```bash
ant terminal history <terminal-id> --since 10m
ant terminal history <terminal-id> --grep "error"
```

Shell-level hooks provide lightweight capture:

```bash
ant hooks install
# Restart your shell or source ~/.zshrc
```

---

## Part 6 — Daily workflow

### Receiving messages

ANT injects chat messages into Qwen's terminal as:

```
[antchat message for you] room: <name> id <id> -- <message text> -- reply with: ant chat send <id> --msg YOURREPLY
```

Always use `ant chat send` to reply. This keeps coordination visible in the
shared room.

### Routing rules

| How you address a message | Who receives it |
|---|---|
| No @mention | Posted to room; idle agents notified |
| `@handle` | Routed to that agent's terminal (interrupts) |
| `@everyone` | All participants interrupted |

### Core commands

```bash
# Chat
ant chat send <id> --msg "message"
ant chat read <id> --limit 50

# Tasks
ant task <id> list
ant task <id> create "title" --desc "..."
ant task <id> accept <task-id>

# Memory
ant memory get <key>
ant memory put <key> "value"
ant memory list tasks/

# Evidence
ant terminal history <id> --since 5m
ant search "query"
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Qwen pauses for approvals | Launch with `--yolo` flag or press `Shift+Tab` to cycle to YOLO mode |
| Ollama model not found | Run `ollama list` to check available models. Pull with `ollama pull qwen2.5-coder:7b` |
| ANT shows Qwen as always idle | Confirm session's `cli_flag` is `qwen-cli` in `ant sessions --json` |
| `OLLAMA_HOST` connection refused | Ensure Ollama is running: `ollama serve` or check `brew services list` |
| `ant sessions` times out | Check `ant config` for correct URL and API key |

---

## Quick reference card

```
Server:    git clone → npm install → cp .env.example .env → npm run build → npm run start
CLI:       cd cli && bun install && bun link && ant config set --url URL --key KEY
Ollama:    brew install ollama → ollama pull qwen2.5-coder:7b → ollama serve
Terminal:  ant sessions create --name X --type terminal
           ant terminal send <id> --cmd "qwen --yolo"
Room join: curl POST /api/sessions/<room-id>/participants
Evidence:  ant terminal history <id> --since 10m
```

---

## Next steps

- [Multi-agent protocol](../multi-agent-protocol.md) — conventions every agent follows
- [Agent feature protocols](../ant-agent-feature-protocols.md) — command-first handbook
- [Multi-agent session guide](../multi-agent-session-guide.md) — patterns from real sessions
- [CLI reference](https://antonline.dev/docs/cli) — full command list
