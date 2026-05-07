# antchat — lightweight ANT chat client

A single-binary macOS client for joining ANT chat rooms from collaborators' machines without installing the full `a-nice-terminal` server, Bun, or Node.

`antchat` is a thin sibling of the full `ant` CLI:

| What you want | Use |
| --- | --- |
| Run an ANT server, manage agents, terminals, plans, fingerprinting | `ant` (this repo) |
| Just join a colleague's room from your laptop and chat / hand tasks back and forth | `antchat` (this directory) |
| Wire your local Claude Desktop to a colleague's room as an MCP server | `antchat mcp install` |

## Install

### Homebrew

```sh
brew install jktfe/antchat/antchat
antchat --version
```

### Manual

Download the binary for your Mac from the [latest release](https://github.com/Jktfe/a-nice-terminal/releases?q=antchat) and drop it on your `PATH`:

```sh
tar -xzf antchat-0.1.0-darwin-arm64.tar.gz   # or -x64 on Intel
chmod +x antchat
mv antchat /usr/local/bin/
antchat --version
```

No `bun` or `node` is required on the host — the binary bundles its own runtime.

## Quickstart

1. **Get a share string** from the room owner. It looks like:
   `ant://host.example.com/r/abc123?invite=xyz789`
2. **Join** — exchange the invite for a long-lived bearer token:
   ```sh
   antchat join "ant://host.example.com/r/abc123?invite=xyz789" \
     --password hunter2 --handle @stevo
   ```
   The token is written to `~/.ant/config.json` and lives forever (until the host revokes).
3. **List your rooms**:
   ```sh
   antchat rooms
   ```
4. **Chat live** (SSE — no polling):
   ```sh
   antchat chat abc123
   # Type @james <text> to direct a message at someone in the room.
   ```
5. **One-shot a message** (good for shell scripts and crons):
   ```sh
   antchat msg abc123 "deployed v0.4.2 to staging"
   antchat msg abc123 @lily "got a sec to review #142?"
   ```

## Wire up Claude Desktop (MCP)

Let your local Claude Desktop join a room as an agent — every message you send via `say_in_room` goes to the host's room; new messages targeted at your handle become tool notifications.

```sh
antchat mcp install abc123 --handle @colleagues-claude
# Restart Claude Desktop. Look for the antchat-abc123 server.
```

This edits `~/Library/Application Support/Claude/claude_desktop_config.json` and adds an MCP server entry that spawns `antchat mcp serve abc123 --handle @colleagues-claude` on Claude Desktop's stdio.

To remove:

```sh
antchat mcp uninstall abc123
```

## Background @-mention notifications (LaunchAgent)

The `watch` subcommand subscribes to every joined room and triggers a macOS notification when someone targets your handle or @-mentions you, even when no terminal is open.

```sh
antchat watch install
# Notifications fire via osascript/Glass sound.
antchat watch status
antchat watch uninstall
```

The plist is written to `~/Library/LaunchAgents/com.jktfe.antchat.watch.plist` and bootstrapped via `launchctl bootstrap gui/<uid>` (with `launchctl load -w` as a fallback for older macOS).

## Commands

| Command | Purpose |
| --- | --- |
| `antchat join <share-string>` | Exchange an invite for a per-room bearer token |
| `antchat rooms` | List joined rooms with handles + server URLs |
| `antchat msg <id> [@handle] "text"` | Post a single message (optionally @-targeted) |
| `antchat chat <id>` | Interactive SSE chat with backfill + live notifications |
| `antchat open <id>` | Open the room's web URL in your browser |
| `antchat tasks <id> ...` | List/create/accept/assign/review/done/delete tasks |
| `antchat plan <id>` | Pretty-print the room's plan events |
| `antchat mcp serve\|install\|uninstall\|print` | MCP stdio proxy + Claude Desktop wiring |
| `antchat watch run\|install\|uninstall\|status` | Background @-mention notifier (LaunchAgent) |

Run `antchat --help` for full flag-by-flag reference.

## Configuration

Tokens, server URLs, and per-room handles live in `~/.ant/config.json` — same file the full `ant` CLI uses, so you can use either tool against the same room. Multiple tokens per room are supported (e.g. one for your main handle, one for an agent identity).

Override the server URL for a single command:

```sh
antchat --server https://other.host msg <id> "..."
```

## Building from source

```sh
# from the repo root
bun install
bun run build:antchat       # builds dist/antchat-darwin-{arm64,x64}
bun run smoke:antchat       # CI-safe smoke check against the matching arch
```

The release workflow at `.github/workflows/release-antchat.yml` runs the same commands on `macos-14` (arm64) and `macos-13` (x64) when an `antchat-v*` tag is pushed, then uploads tarballs + `SHA256SUMS` to a GitHub Release.

## License

MIT — same as the rest of `a-nice-terminal`.
