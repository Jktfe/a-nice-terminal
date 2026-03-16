# ANTcli — CLI for A Nice Terminal

**Date**: 2026-03-16
**Status**: Approved

## Overview

A CLI tool (`ant`) that lets both humans and AI agents interact with ANT sessions by name. Wraps the REST API + WebSocket for real-time streaming. Lives in `packages/cli/` as an independent package.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary consumer | Both humans and agents equally | Human-readable output by default, `--json` for agents |
| Session resolution | Name or ID, fuzzy disambiguation | Try ID first, then fuzzy name match, error if ambiguous |
| Command style | Git-style subcommands + short aliases | `ant read` / `ant r` — clean for humans, predictable for agents |
| Package location | `packages/cli/` — new package | Clean separation, no server coupling, independently installable |
| Architecture | HTTP + WebSocket hybrid | HTTP for CRUD, WebSocket for streaming (`exec`, `read --follow`) |
| Auth/discovery | Flags > env > config > auto-discover localhost:6458 | Works out of the box, configurable for remote/Tailscale |
| Non-interactive exec | Uses Agent API REST endpoint | `POST /api/agent/sessions/:id/exec` for non-interactive; WebSocket only for `-i` and `--follow` |

## Package Structure

```
packages/cli/
├── package.json          # bin: { "ant": "./dist/ant.js" }
├── tsconfig.json
├── src/
│   ├── ant.ts            # Entry point — arg parsing, command dispatch
│   ├── client.ts         # HTTP client (fetch wrapper with auth)
│   ├── ws.ts             # Socket.IO client for streaming commands
│   ├── resolve.ts        # Session name→ID resolution with fuzzy match
│   ├── output.ts         # Formatters: human-readable + JSON modes
│   ├── keys.ts           # Key name → ANSI escape sequence mapping
│   ├── config.ts         # Config loading: flags > env > config file > auto-discover
│   └── commands/
│       ├── read.ts       # ant read <session>
│       ├── post.ts       # ant post <session> <message>
│       ├── search.ts     # ant search <query>
│       ├── list.ts       # ant list
│       ├── members.ts    # ant members <session>
│       ├── filter.ts     # ant filter <session> <sender>
│       ├── create.ts     # ant create <name>
│       ├── exec.ts       # ant exec <session> <command>
│       ├── attach.ts     # ant attach <session>
│       ├── screen.ts     # ant screen <session>
│       ├── delete.ts     # ant delete <session>
│       ├── archive.ts    # ant archive <session>
│       ├── restore.ts    # ant restore <session>
│       ├── rename.ts     # ant rename <session> <new-name>
│       └── health.ts     # ant health
```

**Dependencies**: `commander` (arg parsing), `socket.io-client` (WebSocket), `chalk` (terminal colours). No native addons — works with bun or node.

## Session Name Resolution (`resolve.ts`)

Every command that takes `<session>` runs through the resolver:

1. **Try as ID** — `GET /api/sessions/:input` → if 200, done (returns full session object)
2. **Search by name** — `GET /api/search?q=input` → filter session results by name match
3. **Score matches** — exact case-insensitive match wins, then substring, then contains
4. **Fetch full session** — `GET /api/sessions/:id` on the matched result (search only returns summary fields)
5. **Disambiguate**:
   - 1 match → use it
   - 0 matches → error: `No session found matching "X"`
   - 2+ matches → error: `Ambiguous: "X" matches N sessions` (list them with IDs)

**Session type routing**: After resolution, the resolver returns the full session object including `type`. Commands use `session.type` to determine which API endpoint to call (messages vs terminal).

No client-side cache for v1 — one API call per resolution.

## Unique Name Enforcement (Server-Side Changes)

Required for reliable name-based resolution.

### On create

`POST /api/sessions` validates:

```sql
SELECT id FROM sessions WHERE name = ? COLLATE NOCASE AND archived = 0
```

If a match exists → 409: `{ "error": "A session named 'X' already exists" }`

**Default name collision handling**: When no name is provided, auto-generate unique defaults: "Terminal", "Terminal 2", "Terminal 3", etc. (same for "Conversation"). Query for existing names with the prefix and increment.

### On rename

`PATCH /api/sessions/:id` validates:

```sql
SELECT id FROM sessions WHERE name = ? COLLATE NOCASE AND archived = 0 AND id != ?
```

### On archive

After setting `archived = 1`, auto-rename:
- `"Dev Notes"` → `"Dev Notes (archived 2026-03-16 09:47:32)"`
- Includes seconds to avoid collisions on same-minute re-archives
- Frees the original name for reuse

### On restore

- Strip the ` (archived ...)` suffix using pattern: `/ \(archived \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)$/`
- If the original name is taken by another active session, keep the suffixed name and let the user rename
- If the session was manually renamed while archived (suffix doesn't match pattern), leave name unchanged

### Case sensitivity

Both uniqueness checks and the CLI resolver use case-insensitive matching (`COLLATE NOCASE` on server, case-insensitive comparison in resolver). "Dev Notes" and "dev notes" cannot coexist as active sessions.

### Concurrency

Single-server SQLite with WAL mode + `busy_timeout = 5000` serialises writes. The check-then-write pattern is safe for this deployment model.

## Commands

### `ant read <session>` / `ant r`

- After resolving session, checks `session.type`:
  - Conversations: `GET /api/sessions/:id/messages`
  - Terminals: `GET /api/sessions/:id/terminal/output`
- Flags: `--limit N` (default 50), `--since <value>`, `--follow`, `--plain` (strip ANSI from terminal output)
- `--since` semantics differ by session type:
  - Conversations: ISO timestamp string (e.g. `2026-03-16T09:00:00`)
  - Terminals: numeric chunk cursor index
- `--follow`: connects via WebSocket, prints new content as it arrives. `ctrl+c` to stop.
  - Conversations: main socket → `join_session` → listen for `message_created` events
  - Terminals: `/terminal` namespace → `join` → listen for `out` events (binary `Uint8Array`, decoded to UTF-8 string)

### `ant post <session> <message>` / `ant p`

- After resolving session, checks `session.type`:
  - Conversations: `POST /api/sessions/:id/messages` with `{ content, role, sender_name, sender_type }`
  - Terminals: `POST /api/sessions/:id/terminal/input` with `{ data }`. Auto-appends `\r` (Enter) unless `--raw` flag is set.
- Flags:
  - Conversation-only: `--role <human|agent|system>` (default human), `--sender-name <name>`, `--sender-type <type>`
  - Terminal-only: `--key <keyname>`, `--seq "down:2,tab,enter"`, `--raw` (no auto-Enter)
  - Using `--key`/`--seq` on a conversation → error: `--key and --seq are only valid for terminal sessions`
  - Using `--role`/`--sender-name` on a terminal → silently ignored (not relevant)
- **stdin support**: If no `<message>` argument and stdin is not a TTY, reads from stdin. `echo "hello" | ant post "Dev Notes"`
- Returns: message ID for conversations, `{ accepted: true }` for terminals

### `ant search <query>` / `ant s`

- `GET /api/search?q=query`
- Flags: `--workspace <name>` (resolved to ID via workspace lookup), `--limit N`, `--include-archived`
- **Note**: `--include-archived` requires server-side change to `/api/search` endpoint (currently hardcodes `WHERE archived = 0`). Until implemented, flag is accepted but warns that archived results may be incomplete.
- Human output: grouped by session, shows matching snippets

### `ant list` / `ant ls`

- `GET /api/sessions?include_archived=true`
- Flags: `--archived` (only archived), `--type <terminal|conversation>`, `--workspace <name>`
- Filtering is client-side (fetch all, filter locally). Acceptable for typical deployment sizes.
- Workspace flag resolves name to ID via `GET /api/workspaces`, then filters `workspace_id` match.

### `ant members <session>` / `ant m`

- Fetches messages, extracts unique `sender_name` / `sender_type` pairs with counts
- Human output: table of participants with message counts

### `ant filter <session> <sender>` / `ant f`

- Fetches messages, client-side filter by `sender_name` or `sender_type`
- Flags: `--limit N`, `--role <human|agent|system>`
- Human output: same as `read` but filtered

### `ant create <name>` / `ant c`

- `POST /api/sessions` with unique name enforcement
- Flags: `--type <terminal|conversation>` (default conversation), `--workspace <name>`, `--cwd <path>`
- Returns session ID + name

### `ant delete <session>` / `ant rm`

- Resolves session, then `DELETE /api/sessions/:id`
- Prompts for confirmation in human mode (unless `--force`). No prompt in `--json` mode.
- Returns `{ deleted: true }`

### `ant archive <session>`

- `PATCH /api/sessions/:id { archived: true }`
- Server auto-renames with timestamp suffix
- Returns updated session

### `ant restore <session>`

- `PATCH /api/sessions/:id { archived: false }`
- Server strips archive suffix if original name is available
- Returns updated session

### `ant rename <session> <new-name>`

- `PATCH /api/sessions/:id { name: newName }`
- Subject to unique name enforcement — 409 if name is taken

### `ant exec <session> <command>` / `ant x`

- Terminal sessions only. Error on conversation: `exec requires a terminal session`
- **Non-interactive** (default): Uses Agent API `POST /api/agent/sessions/:id/exec` with `{ command, timeout }`. Returns `{ exitCode, output, durationMs }`. Streams output to stdout as it arrives.
- **Interactive**: `--interactive` / `-i` — see `ant attach` below. When `-i` is set, `<command>` is optional; if provided, it's sent as initial input after attaching.
- Flags: `--timeout <seconds>` (default 30), `--quiet` (suppress output, return exit code only)
- Exit code mirrors the remote command's exit code
- On timeout: disconnects from the session. Does NOT kill the remote process.
- `ant exec "Build"` with no command and no `-i` → error: `Provide a command or use -i for interactive mode`

### `ant attach <session>` / `ant a`

- Terminal sessions only. Full interactive bidirectional TTY attach via WebSocket.
- Connect to `/terminal` namespace → `join` → raw mode
- Local TTY: `process.stdin.setRawMode(true)`
- Bidirectional: stdin → WS `in` (as `Uint8Array`), WS `out` (binary `Uint8Array`) → decoded to UTF-8 → stdout
- Detach: `ctrl+]` (like telnet). Sends nothing to remote, just disconnects.
- Restores TTY settings on exit (including on crash via `process.on('exit')`)

### `ant screen <session>` / `ant sc`

- `GET /api/sessions/:id/terminal/state?format=ansi`
- Terminal sessions only
- Flags: `--plain` (strip ANSI codes)
- `--lines N`: client-side — splits output by newlines, returns last N lines

### `ant health`

- `GET /api/health`
- Reports: server status, version, uptime
- Useful for debugging connectivity

## Key Sequence Vocabulary (`keys.ts`)

| Token | Escape sequence |
|-------|----------------|
| `up` | `\x1b[A` |
| `down` | `\x1b[B` |
| `right` | `\x1b[C` |
| `left` | `\x1b[D` |
| `tab` | `\t` |
| `enter` | `\r` |
| `space` | ` ` |
| `escape` / `esc` | `\x1b` |
| `ctrl+c` | `\x03` |
| `ctrl+d` | `\x04` |
| `backspace` | `\x7f` |
| `delete` | `\x1b[3~` |
| `home` | `\x1b[H` |
| `end` | `\x1b[F` |

**Repeat shorthand**: `down:3` = `down,down,down`
**Delay**: `wait:500` = 500ms pause (approximate — setTimeout precision)

## WebSocket Streaming (`ws.ts`)

### `ant read --follow`
- Conversations: main socket → `join_session` → `message_created` events
- Terminals: `/terminal` namespace → `join` → `out` events (binary payload, decode with `TextDecoder`)
- Clean disconnect on `ctrl+c`

### `ant attach` / `ant exec -i`
- `/terminal` namespace → `join`
- Local TTY raw mode → bidirectional binary streaming
- All payloads are `Uint8Array` / `Buffer` — encode with `TextEncoder`, decode with `TextDecoder`
- Detach: `ctrl+]`
- Restores TTY on exit

### `ant exec` (non-interactive)
- Uses Agent API REST endpoint `POST /api/agent/sessions/:id/exec` — no WebSocket needed
- Returns structured `{ exitCode, output, durationMs }`

Each streaming command creates a short-lived socket connection. No persistent daemon.

## Config & Auth (`config.ts`)

**Precedence** (highest to lowest):
1. CLI flags: `--server`, `--api-key`
2. Env vars: `ANT_URL`, `ANT_API_KEY`
3. Config file: `~/.config/ant/config.json`
4. Auto-discover: `http://localhost:6458`

**Config file**:
```json
{
  "server": "http://100.x.x.x:6458",
  "apiKey": "my-key",
  "defaultFormat": "human"
}
```

**Health check**: Every command validates connectivity on first call. Clear error on failure: `Cannot reach ANT server at http://localhost:6458`

**Port note**: The main ANT server port is configured via `ANT_PORT` env var (default 3000, typically set to 6458). The auto-discover tries `ANT_PORT` from the environment first, then falls back to `http://localhost:6458`.

## Output Formatting (`output.ts`)

**Human mode** (default): Coloured, formatted output with headers and tables. Uses `chalk`, respects `NO_COLOR` env var and `--no-color` flag. TTY detection — no colour when piped.

**JSON mode** (`--json`): Raw API response, no formatting, no colour. Agents parse directly.

## Global Flags

| Flag | Env var | Description |
|------|---------|-------------|
| `--json` | — | Output raw JSON instead of human-readable |
| `--no-color` | `NO_COLOR` | Disable colour output |
| `--server <url>` | `ANT_URL` | Server URL |
| `--api-key <key>` | `ANT_API_KEY` | API key for authentication |

## Server-Side Changes Required

| Change | Endpoint | Description |
|--------|----------|-------------|
| Unique name enforcement | `POST /api/sessions`, `PATCH /api/sessions/:id` | Reject duplicate active session names (COLLATE NOCASE) |
| Auto-increment default names | `POST /api/sessions` | "Terminal 2", "Terminal 3" when no name provided |
| Archive auto-rename | `PATCH /api/sessions/:id` | Append ` (archived YYYY-MM-DD HH:mm:ss)` on archive |
| Restore strip suffix | `PATCH /api/sessions/:id` | Remove archive suffix on restore if original name free |
| Search include archived | `GET /api/search` | Add `?include_archived=true` query parameter support |

## Error Handling

- Connection errors: `Cannot reach ANT server at <url>`
- Resolution errors: `No session found matching "X"` / `Ambiguous: "X" matches N sessions`
- Type mismatch: `exec requires a terminal session` / `--key and --seq are only valid for terminal sessions`
- Archived session input: `Session "X" is archived (read-only)`
- Name collision: `A session named "X" already exists`
- Missing args: `Provide a command or use -i for interactive mode`
- All errors go to stderr. Exit code 1 for errors, 0 for success, or mirrored exit code for `exec`.
