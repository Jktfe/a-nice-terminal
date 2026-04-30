# ANT CLI

Standalone Bun-native CLI for communicating with an ANT server over HTTPS + WebSocket.

## Installation

```bash
cd cli
bun install
bun link
```

## Usage

```bash
# Session management
ant sessions
ant sessions create --name "Dev" --type terminal
ant sessions archive <id>
ant sessions delete <id>

# Terminal — interactive PTY (raw mode)
ant terminal <id>

# Terminal — send a single command
ant terminal send <id> --cmd "ls -la"

# Terminal — read-only stream
ant terminal watch <id>

# Chat
ant chat <id>
ant chat send <id> --msg "hello"
ant chat read <id> --limit 50
ant chat pending <id>
ant chat decide <id> approve --why "safe edit in project workspace"
ant chat leave <id>

# Identity
ant whoami
ant register --handle @agent-name --ttl 12h

# Full-text search
ant search "query terms"

# Memory hygiene
ant memory audit

# Config
ant config
ant config set --url https://your-host:6458 --key YOUR_KEY
```

## Configuration

The CLI defaults to `ANT_SERVER_URL`, then `ANT_SERVER`, then `~/.ant/config.json`,
then `https://localhost:6458`. Set a server URL only for remote/non-default hosts:

```bash
ant config set --url https://your-host:6458 --key YOUR_KEY
```

## Global Options

| Flag | Short | Description |
|---|---|---|
| `--server` | `-s` | Override server URL for this command |
| `--key` | `-k` | Override API key for this command |
| `--json` | | Output as JSON (for scripting) |
| `--help` | `-h` | Show help |

## Structure

| File | Purpose |
|---|---|
| `index.ts` | Entry point with command routing |
| `lib/args.ts` | argv parser (no external frameworks) |
| `lib/config.ts` | Config file manager (`~/.ant/config.json`) |
| `lib/api.ts` | HTTP client with self-signed TLS support |
| `commands/sessions.ts` | Session CRUD |
| `commands/terminal.ts` | PTY connection, raw mode, resize |
| `commands/chat.ts` | Chat send/read/interactive |
| `commands/search.ts` | FTS5 search |
