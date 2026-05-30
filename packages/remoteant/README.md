# @jktfe/remoteant

Personal MCP gateway for antchat-mac. A bun-native binary that speaks JSON-RPC 2.0 over stdio, implementing the Model Context Protocol (MCP) so Claude Desktop, Claude Code, and other MCP clients can discover and invoke ANT tools.

## A1 scope

This package ships the daemon scaffold:

- `--mcp-stdio` — MCP stdio adapter with `initialize` handshake, `ant.ping`, and `tools/list`
- `--version` — semver + git sha identity
- `install` / `serve` / `supervise` — stubbed for future phases

Out of scope for A1: WebSocket/SSE transport, full 6 JSON-RPC methods, auth nonces, audit logging, code signing, Homebrew distribution, and the macOS NSTask integration (E2 handles that in the Antchat repo).

## Build

```sh
cd packages/remoteant
bun install
bun run build
```

Produces `dist/cli.js` as a single-file bundle suitable for shipping into the Antchat Mac bundle at `/Applications/Antchat.app/Contents/Resources/remoteant`.

## Test

```sh
bun test
```

Runs vitest against the built `dist/cli.js`, spawning it as a child process and exchanging JSON-RPC over stdio.
