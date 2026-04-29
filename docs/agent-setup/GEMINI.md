# ANT Setup Skill — Gemini CLI

This file tells Gemini CLI how to set up ANT (A Nice Terminal) on a new
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

## Part 3 — Gemini CLI hook integration

Gemini CLI v0.37.0+ supports a native hooks system via `.gemini/settings.json`.
ANT provides a hook script that forwards Gemini lifecycle events to the ANT
server in real time.

### Install the hook script

```bash
# From your project root:
mkdir -p .gemini/hooks

cat > .gemini/hooks/ant-hook.sh << 'EOF'
#!/bin/bash
# ANT Gemini Hook — forwards Gemini CLI events to the ANT server
INPUT=$(cat)
ANT_SERVER="${ANT_SERVER:-https://localhost:6458}"
PAYLOAD=$(echo "$INPUT" | jq -c ". + {\"ant_session_id\": \"${ANT_SESSION:-unknown}\", \"agent\": \"gemini-cli\"}")
curl -sk -X POST "${ANT_SERVER}/api/hooks" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  > /dev/null 2>&1
exit 0
EOF

chmod +x .gemini/hooks/ant-hook.sh
```

### Configure `.gemini/settings.json`

```json
{
  "hooks": {
    "SessionStart": [
      { "name": "ant-session-start", "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }
    ],
    "BeforeTool": [
      { "name": "ant-tool-start", "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }
    ],
    "AfterTool": [
      { "name": "ant-tool-end", "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }
    ],
    "AfterAgent": [
      { "name": "ant-agent-stop", "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }
    ],
    "SessionEnd": [
      { "name": "ant-session-end", "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }
    ]
  }
}
```

The hook reads `ANT_SERVER` and `ANT_SESSION` from the environment, both of
which ANT sets automatically when Gemini runs inside a managed terminal session.

---

## Part 4 — Gemini CLI behaviour in ANT

ANT's Gemini driver was fingerprinted against Gemini CLI v0.37.0.
Key characteristics:

- **No per-tool approval TUI** — Gemini manages approval via mode toggle.
  `Shift+Tab` cycles: default → auto-accept edits → plan mode.
- **Response prefix**: `✦` (filled diamond).
- **Idle state**: `? for shortcuts` in the status bar.
- **Tool result boxes**: `│ ✓ WriteFile`, `│ ✓ Shell`, `│ ✓ ReadFile`

For unattended ANT sessions, start Gemini in auto-accept mode or configure
YOLO mode so it does not pause for approvals:

```bash
# Inside the ANT terminal session, press Shift+Tab once to enter auto-accept mode
# Or launch with sandboxing disabled if your environment supports it:
gemini --sandbox none
```

### Launch Gemini inside an ANT terminal session

```bash
# 1. Create a terminal session
ant sessions create --name "myGemini" --type terminal --json

# 2. Navigate to your project
ant terminal send <terminal-id> --cmd "cd ~/path/to/project"

# 3. Launch Gemini CLI
ant terminal send <terminal-id> --cmd "gemini"

# 4. Switch to auto-accept mode (send Shift+Tab)
ant terminal key <terminal-id> BTab
```

### Add Gemini to a shared chatroom

```bash
curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \
  -H 'content-type: application/json' \
  --data '{"session_id":"<terminal-id>","role":"participant","alias":"@gemini"}'

ant chat send <room-id> --msg "@gemini please read the project README and let us know what you can help with."
```

---

## Part 5 — Daily workflow

### Receiving messages

ANT injects chat messages into Gemini's terminal as:

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
| Hook script not firing | Check `chmod +x .gemini/hooks/ant-hook.sh` and that `$GEMINI_PROJECT_DIR` resolves correctly |
| `ANT_SESSION` is `unknown` | Gemini is not running inside an ANT-managed tmux session. Use `ant sessions create --type terminal` first. |
| Gemini pauses for approvals | Switch to auto-accept mode: press `Shift+Tab` once, or send `ant terminal key <id> BTab` |
| ANT shows Gemini as always idle | Confirm session's `cli_flag` is `gemini-cli` in `ant sessions --json` |
| `ant sessions` times out | Check `ant config` for correct URL and API key |

---

## Quick reference card

```
Server:    git clone → npm install → cp .env.example .env → npm run build → npm run start
CLI:       cd cli && bun install && bun link && ant config set --url URL --key KEY
Hooks:     mkdir -p .gemini/hooks → install ant-hook.sh → configure settings.json
Terminal:  ant sessions create --name X --type terminal
           ant terminal send <id> --cmd "gemini"
           ant terminal key <id> BTab   (enter auto-accept mode)
Room join: curl POST /api/sessions/<room-id>/participants
```

---

## Next steps

- [Gemini hooks reference](../suggested-hooks-for-gemini.md) — full hook spec and event mapping
- [Multi-agent protocol](../multi-agent-protocol.md) — conventions every agent follows
- [Agent feature protocols](../ant-agent-feature-protocols.md) — command-first handbook
- [CLI reference](https://antonline.dev/docs/cli) — full command list
