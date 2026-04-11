# ANT — A Nice Terminal

A self-hosted terminal multiplexer and chat interface. Run terminal sessions and chat conversations from your browser or CLI, accessible over HTTPS from anywhere on your Tailscale network.

## Features

- **Live terminal sessions** — full PTY streaming via WebSocket and xterm.js (WebGL-accelerated)
- **Keyboard-correct** — Esc, Tab, Ctrl+C, arrows, Option/Alt, and paste all work; DA1/DA2 feedback loop prevented
- **Slow Edit mode** — compose multi-line commands in a textarea before sending to the PTY
- **Chat sessions** — persistent message threads with FTS5 full-text search
- **PTY Chat mode** (🤖) — terminal output appears as chat bubbles; type commands inline
- **Linked-chat bridge** — pair any terminal with a chat; tmux `alert-silence` hook + `#{pane_title}` polling surface prompts/state to the chat; user-role messages typed in the chat are auto-forwarded as keystrokes to answer interactive prompts (opt-out via `auto_forward_chat=0`)
- **Memory panel** — key/value memory store with FTS5 search; agents can save and recall facts
- **Toast notifications** — visual feedback for wake, cross-post, and save actions
- **Share** — generate CLI commands so other clients (agents or humans) can join any session
- **CLI tool** (`ant`) — manage and connect to sessions from anywhere
- **API key auth** — optional bearer token protection on all API and WebSocket endpoints
- **Tailscale-only mode** — restrict to your private network
- **HTTPS/TLS** — self-signed cert support, configurable via env vars
- **launchd daemon** — runs as a persistent background service on macOS

## Stack

- **Frontend**: Svelte 5 + SvelteKit + Tailwind CSS
- **Server**: Node.js custom HTTP/WebSocket server
- **Terminal**: node-pty → WebSocket → xterm.js
- **Database**: SQLite (better-sqlite3 / bun:sqlite) with WAL + FTS5
- **CLI**: Bun-native TypeScript

## Quick Start

```bash
# Install dependencies
npm install   # or: bun install

# Build
npm run build

# Start server
npm run start
# Server runs at http://localhost:6458
```

## CLI

```bash
cd cli && bun install && bun link

ant sessions                              # List sessions
ant sessions create --name "Dev" --type terminal
ant terminal <id>                         # Interactive PTY
ant terminal watch <id>                   # Read-only stream
ant terminal send <id> --cmd "ls -la"    # One-shot command
ant chat <id>                             # Interactive chat
ant chat send <id> --msg "hello"
ant search "query"                        # FTS5 search
ant config set --url https://host:6458 --key YOUR_KEY
```

## Configuration

Copy `.env.example` to `.env`:

```bash
ANT_PORT=6458
ANT_HOST=0.0.0.0
ANT_API_KEY=               # Optional: bearer token for all endpoints
ANT_TAILSCALE_ONLY=true    # Restrict to Tailscale 100.x.x.x IPs
ANT_TLS_CERT=./certs/ant-tls.crt
ANT_TLS_KEY=./certs/ant-tls.key
ANT_DATA_DIR=~/.ant-v3     # SQLite database location
ANT_SERVER_URL=            # Public URL used in share commands
```

## launchd Daemon (macOS)

Copy `ant.server.plist.example` to `~/Library/LaunchAgents/ant.server.plist`, fill in your paths, then:

```bash
launchctl load ~/Library/LaunchAgents/ant.server.plist
```

## API

```
GET  /api/health
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:id
PATCH /api/sessions/:id
DELETE /api/sessions/:id
GET  /api/sessions/:id/messages
POST /api/sessions/:id/messages
GET  /api/sessions/:id/share
POST /api/sessions/:id/terminal/input
GET  /api/search?q=...
GET  /api/memories?q=...&limit=
POST /api/memories
DELETE /api/memories?id=
GET  /api/workspaces
WS   /ws    (join_session, terminal_input, terminal_resize, terminal_output)
```

Authentication: `Authorization: Bearer <key>`, `X-API-Key: <key>`, or `?apiKey=<key>`. Also accepted on WebSocket upgrade URL as `?apiKey=<key>`.
