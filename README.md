# ANT - A Nice Terminal

A local web interface that combines real terminal sessions with structured conversation sessions, plus a REST API and MCP server for AI agent interaction.

## What is ANT?

ANT gives you two session types in a single, clean web UI:

- **Terminal sessions** -- real PTY shells (bash, zsh, etc.) rendered with xterm.js, running on your machine.
- **Conversation sessions** -- structured text mailboxes where humans and AI agents exchange messages via REST API or WebSocket.

AI agents (Claude Code, Cursor, custom scripts) can create sessions, post messages, and stream responses -- either through the REST API directly or via the bundled MCP server.

ANT supports both local and Tailscale-first access. By default, set `ANT_HOST=0.0.0.0` and keep `ANT_TAILSCALE_ONLY=true` for mesh-constrained exposure.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Jktfe/a-nice-terminal.git
cd a-nice-terminal

# 2. Install
bun install

# 3. Run
bun run dev
```

Open the app on your configured host (for Tailscale, this is typically `http://100.64.x.x:3000`).

### Requirements

- Node.js >= 22.12.0
- [Bun](https://bun.sh) package manager
- macOS, Linux, or WSL (node-pty requires a Unix-like environment)

### Configuration

Copy `.env.example` to `.env` and adjust as needed:

```bash
# Port (default: 3000)
ANT_PORT=3000
ANT_HOST=0.0.0.0
ANT_TAILSCALE_ONLY=true
ANT_ALLOWLIST=100.64.0.0/10
ANT_ALLOW_LOOPBACK=false

# Optional API key -- if set, all API requests must include it
# ANT_API_KEY=your-secret-key
# Optional browser auth key for authenticated frontend/API calls
# VITE_ANT_API_KEY=your-secret-key
```

## Architecture

```
+--------------------------------------------------+
|                   Browser UI                      |
|  (React 19 + xterm.js + Tiptap + Zustand)        |
+---------------------------+----------------------+
                            |
                      Socket.IO / HTTP
                            |
+---------------------------+----------------------+
|                  Express Server                   |
|  +-------------+  +------------+  +------------+ |
|  |  REST API   |  | WebSocket  |  | Vite (dev) | |
|  |  /api/*     |  | handlers   |  | middleware  | |
|  +------+------+  +-----+------+  +------------+ |
|         |               |                         |
|  +------+---------------+------+                  |
|  |          SQLite (WAL)       |                  |
|  |  sessions | messages        |                  |
|  +-----------------------------+                  |
|         |                                         |
|  +------+------+                                  |
|  |  node-pty   |  (terminal sessions only)        |
|  +-------------+                                  |
+--------------------------------------------------+

+--------------------------------------------------+
|              MCP Server (stdio)                   |
|  Wraps REST API for Claude Code, Cursor, etc.     |
+--------------------------------------------------+
```

## API Reference

All endpoints are served from your configured host and port. If `ANT_API_KEY` is set, include it as an `X-API-Key` header or `Authorization: Bearer <key>`.
For Tailscale-reachable deployments, configure `ANT_HOST` and `ANT_ALLOWLIST` accordingly and use the visible Tailscale IP in examples.

### Health

```bash
curl http://$ANT_HOST:$ANT_PORT/api/health
# {"status":"ok","version":"0.1.0"}
```

### Sessions

**List all sessions**

```bash
curl http://$ANT_HOST:$ANT_PORT/api/sessions
```

**Create a session**

```bash
# Conversation session
curl -X POST http://$ANT_HOST:$ANT_PORT/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"type": "conversation", "name": "My Chat"}'

# Terminal session
curl -X POST http://$ANT_HOST:$ANT_PORT/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"type": "terminal", "name": "Dev Shell"}'
```

**Get a single session**

```bash
curl http://$ANT_HOST:$ANT_PORT/api/sessions/:id
```

**Rename a session**

```bash
curl -X PATCH http://$ANT_HOST:$ANT_PORT/api/sessions/:id \
  -H "Content-Type: application/json" \
  -d '{"name": "New Name"}'
```

**Delete a session**

```bash
curl -X DELETE http://$ANT_HOST:$ANT_PORT/api/sessions/:id
```

### Messages (conversation sessions)

**List messages**

```bash
# All messages
curl http://$ANT_HOST:$ANT_PORT/api/sessions/:id/messages

# With filters
curl "http://$ANT_HOST:$ANT_PORT/api/sessions/:id/messages?since=2025-01-01T00:00:00Z&limit=50"
```

**Create a message**

```bash
curl -X POST http://$ANT_HOST:$ANT_PORT/api/sessions/:id/messages \
  -H "Content-Type: application/json" \
  -d '{"role": "agent", "content": "Hello from my script!", "format": "markdown"}'
```

Roles: `human`, `agent`, `system`

**Update a message** (for streaming)

```bash
curl -X PATCH http://$ANT_HOST:$ANT_PORT/api/sessions/:sessionId/messages/:messageId \
  -H "Content-Type: application/json" \
  -d '{"content": "Updated content", "status": "complete"}'
```

**Delete a message**

```bash
curl -X DELETE http://$ANT_HOST:$ANT_PORT/api/sessions/:sessionId/messages/:messageId
```

### Terminal endpoints

```bash
curl -X POST http://$ANT_HOST:$ANT_PORT/api/sessions/:sessionId/terminal/input \
  -H "Content-Type: application/json" \
  -d '{ "data": "ls -la\\n" }'

curl -X POST http://$ANT_HOST:$ANT_PORT/api/sessions/:sessionId/terminal/resize \
  -H "Content-Type: application/json" \
  -d '{ "cols": 120, "rows": 40 }'

curl "http://$ANT_HOST:$ANT_PORT/api/sessions/:sessionId/terminal/output?since=0&limit=200"
```

### WebSocket Events

Connect via Socket.IO at `http://$ANT_HOST:$ANT_PORT`.

| Event (client sends) | Payload | Description |
|---|---|---|
| `join_session` | `{ sessionId }` | Join a session room; starts PTY for terminal sessions |
| `leave_session` | `{ sessionId }` | Leave a session room |
| `terminal_input` | `{ sessionId, data }` | Send keystrokes to the terminal PTY |
| `terminal_resize` | `{ sessionId, cols, rows }` | Resize the terminal |
| `new_message` | `{ sessionId, role, content, format? }` | Send a conversation message via WebSocket |
| `stream_chunk` | `{ sessionId, messageId, content }` | Send a streaming chunk |
| `stream_end` | `{ sessionId, messageId, content }` | Finalise a streaming message |

| Event (server sends) | Payload | Description |
|---|---|---|
| `session_joined` | `{ sessionId, type }` | Confirmation of joining a session |
| `terminal_output` | `{ sessionId, data }` | Terminal output data |
| `message_created` | `Message` | A new message was created |
| `message_updated` | `Message` | A message was updated |
| `message_deleted` | `{ id }` | A message was deleted |

## MCP Server

The bundled MCP server lets AI coding tools (Claude Code, Cursor, Windsurf, etc.) interact with ANT sessions over stdio.

### Setup for Claude Code

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "ant": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/index.ts"],
      "env": {
        "ANT_PORT": "3000"
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|---|---|
| `ant_list_sessions` | List all sessions |
| `ant_create_session` | Create a terminal or conversation session |
| `ant_read_messages` | Read messages from a conversation session (with optional `since` filter) |
| `ant_send_message` | Send a message to a conversation session |
| `ant_stream_message` | Start a streaming message (returns message ID) |
| `ant_complete_stream` | Finalise a streaming message with full content |
| `ant_terminal_input` | Send terminal input to a terminal session |
| `ant_terminal_resize` | Resize a terminal session |
| `ant_read_terminal_output` | Read cursor-based terminal output |

## Tech Stack

- **Frontend**: React 19, xterm.js, Tiptap (rich text editor), Zustand (state), Tailwind CSS v4, Motion (animations), Lucide icons
- **Backend**: Express 4, Socket.IO 4, better-sqlite3 (WAL mode), node-pty
- **MCP**: @modelcontextprotocol/sdk
- **Build**: Vite 6, TypeScript 5.8, Bun

## Project Structure

```
a-nice-terminal/
  packages/
    app/              # Main application (frontend + backend)
      src/            # React frontend
      server/         # Express + Socket.IO backend
    mcp/              # MCP server for AI agent integration
    website/          # Marketing website (SvelteKit + Svelte 5)
```

## Licence

[MIT](./LICENSE) -- Copyright 2024-present James King
