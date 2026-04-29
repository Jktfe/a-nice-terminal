# ANT Setup Skill — Pi Coding Agent

This file tells Pi how to set up ANT (A Nice Terminal) on a new machine and
join a running coordination session. Read it once, follow the steps, and you
will be operational.

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

## Part 3 — Pi behaviour in ANT

ANT's Pi driver integrates with Pi's structured output modes. Key
characteristics:

- **`--mode json`** — Pi emits newline-delimited JSON (JSONL) on stdout.
  ANT parses these records for real-time status and tool tracking.
- **`--mode rpc`** — Pi exposes a bidirectional RPC transport for live
  state queries (`get_state`) and control.
- **JSONL event types** ANT tracks:

| Event type | ANT action |
|---|---|
| `agent_start` / `turn_start` | Session starts, progress indicator begins |
| `message_update` | Streaming response in progress |
| `tool_execution_start` | Tool call begins |
| `tool_execution_update` | Tool call progress |
| `tool_execution_end` | Tool call completes |
| `agent_end` / `turn_end` | Session settled, prompt ready |

- **State detection** uses `get_state` response: `isCompacting` → thinking,
  `isStreaming` → busy, otherwise → ready.

### Launch Pi inside an ANT terminal session

```bash
# 1. Create a terminal session
ant sessions create --name "myPi" --type terminal --json

# 2. Navigate to your project
ant terminal send <terminal-id> --cmd "cd ~/path/to/project"

# 3. Launch Pi in JSON mode for structured ANT integration
ant terminal send <terminal-id> --cmd "pi --mode json"
# Or standard TUI mode (ANT will use text fingerprinting):
ant terminal send <terminal-id> --cmd "pi"
```

### Add Pi to a shared chatroom

```bash
curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \
  -H 'content-type: application/json' \
  --data '{"session_id":"<terminal-id>","role":"participant","alias":"@pi"}'

ant chat send <room-id> --msg "@pi please read the project README and let us know what you can help with."
```

---

## Part 4 — Pi has no native hook system

Pi does not expose a hooks API equivalent to Claude Code's. ANT tracks Pi
state via:

1. **JSONL parsing** (when `--mode json` is used) — highest fidelity.
2. **tmux terminal fingerprinting** — text pattern matching as fallback.

The JSONL integration is the preferred path. Always launch Pi with
`--mode json` inside ANT terminal sessions when possible.

For evidence after a task:

```bash
ant terminal history <terminal-id> --since 10m
ant terminal history <terminal-id> --grep "tool_execution_end"
```

Shell-level hooks provide lightweight capture:

```bash
ant hooks install
# Restart your shell or source ~/.zshrc
```

---

## Part 5 — Daily workflow

### Receiving messages

ANT injects chat messages into Pi's terminal as:

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
| ANT shows Pi as always unknown state | Use `--mode json` so ANT can parse structured events. Without it, ANT falls back to text fingerprinting which may not detect Pi's TUI. |
| JSONL not appearing in terminal history | Check that Pi is actually outputting to stdout and not a separate log file. Use `ant terminal history <id> --grep agent_start` to verify. |
| Messages not reaching Pi | Confirm terminal session is a participant in the room (`curl GET /api/sessions/<room-id>/participants`) |
| `ant sessions` times out | Check `ant config` for correct URL and API key |

---

## Quick reference card

```
Server:    git clone → npm install → cp .env.example .env → npm run build → npm run start
CLI:       cd cli && bun install && bun link && ant config set --url URL --key KEY
Terminal:  ant sessions create --name X --type terminal
           ant terminal send <id> --cmd "pi --mode json"
Room join: curl POST /api/sessions/<room-id>/participants
Evidence:  ant terminal history <id> --since 10m --grep agent_end
```

---

## Next steps

- [Multi-agent protocol](../multi-agent-protocol.md) — conventions every agent follows
- [Agent feature protocols](../ant-agent-feature-protocols.md) — command-first handbook
- [Multi-agent session guide](../multi-agent-session-guide.md) — patterns from real sessions
- [CLI reference](https://antonline.dev/docs/cli) — full command list
