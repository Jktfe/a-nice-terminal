# ANT Setup Skill — Codex CLI

This file tells Codex CLI how to set up ANT (A Nice Terminal) on a new
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

## Part 3 — Codex CLI behaviour in ANT

ANT's Codex driver was fingerprinted against Codex CLI v0.118.0–v0.125.0.
Key characteristics:

- **No permission TUI** — Codex auto-runs all tool calls (read, write,
  execute) without approval dialogs when launched in full-auto mode.
- **v0.118.0**: exited after each response. **v0.125.0+**: stays interactive
  after responding (persistent session).
- **Prompt marker**: `›` (right angle). ANT uses this to detect the idle state.
- **Progress indicator**: `• Working (Ns • esc to interrupt)`
- **Resume**: `codex resume` continues a previous session.

### Launch Codex inside an ANT terminal session

```bash
# 1. Create a terminal session
ant sessions create --name "myCodex" --type terminal --json

# 2. Navigate to your project
ant terminal send <terminal-id> --cmd "cd ~/path/to/project"

# 3. Launch Codex in full-auto mode
ant terminal send <terminal-id> --cmd "codex --approval-policy=full-auto"
# or: codex --approval-policy=auto  (confirms only dangerous ops)
```

### Add Codex to a shared chatroom

```bash
curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \
  -H 'content-type: application/json' \
  --data '{"session_id":"<terminal-id>","role":"participant","alias":"@codex"}'

# Send a natural first contact message
ant chat send <room-id> --msg "@codex please read the project README and assess what needs doing."
```

---

## Part 4 — Codex has no native hook system

Unlike Claude Code, Codex CLI does not expose a hooks API. ANT relies on
tmux terminal fingerprinting (progress lines, prompt markers) to track Codex
state. This means:

- ANT can detect when Codex is working, idle, or has finished a turn.
- ANT cannot receive structured tool-call metadata from Codex directly.
- For richer integration, use the `ant terminal history` command to read
  Codex's output as evidence after a task completes.

### Shell hooks (lightweight alternative)

Shell-level hooks let ANT capture some terminal activity even without native
agent hooks:

```bash
ant hooks install
# Restart your shell or source ~/.zshrc
```

---

## Part 5 — Daily workflow

### Receiving messages

ANT injects chat messages into Codex's terminal as:

```
[antchat message for you] room: <name> id <id> -- <message text> -- reply with: ant chat send <id> --msg YOURREPLY
```

Codex should respond using `ant chat send` as instructed. This keeps
coordination visible in the shared room.

### Resuming after exit

Codex v0.118.0 exits after each response. Resume with:

```bash
ant terminal send <terminal-id> --cmd "codex resume"
```

Or check terminal history to see what it produced:

```bash
ant terminal history <terminal-id> --since 5m
```

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

# Terminal evidence
ant terminal history <id> --since 10m
ant terminal history <id> --grep "error"

# Tasks
ant task <id> list
ant task <id> create "title" --desc "..."
ant task <id> accept <task-id>

# Memory
ant memory get <key>
ant memory put <key> "value"

# Search
ant search "query"
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Codex exits immediately | Use `codex resume` to continue a previous session |
| ANT shows Codex as always idle | Confirm the session's `cli_flag` is set: `ant sessions --json` should show `cli_flag: "codex-cli"` |
| Messages not reaching Codex | Confirm the terminal session is a participant in the room (`curl GET /api/sessions/<room-id>/participants`) |
| `ant sessions` times out | Check `ant config` for correct URL and API key |
| Build stale after source edits | Run `npx vite build` before `npm run start` |

---

## Quick reference card

```
Server:    git clone → npm install → cp .env.example .env → npm run build → npm run start
CLI:       cd cli && bun install && bun link && ant config set --url URL --key KEY
Launch:    ant sessions create --name X --type terminal
           ant terminal send <id> --cmd "codex --approval-policy=full-auto"
Room join: curl POST /api/sessions/<room-id>/participants
Resume:    ant terminal send <id> --cmd "codex resume"
Evidence:  ant terminal history <id> --since 10m
```

---

## Next steps

- [Multi-agent protocol](../multi-agent-protocol.md) — conventions every agent follows
- [Agent feature protocols](../ant-agent-feature-protocols.md) — command-first handbook
- [Multi-agent session guide](../multi-agent-session-guide.md) — patterns from real sessions
- [CLI reference](https://antonline.dev/docs/cli) — full command list
