# CLAUDE.md — ANT (A Nice Terminal)

## What is this project?

ANT is a local web interface combining real terminal sessions (PTY via node-pty + xterm.js) with structured conversation sessions, plus a REST API and MCP server for AI agent interaction. Monorepo managed with pnpm workspaces.

## Quick reference

```bash
pnpm install          # install deps (primary package manager)
pnpm run dev          # start dev server (Vite HMR + Express)
pnpm run lint         # type-check (tsc --noEmit) for app + mcp
pnpm run test         # vitest for app + mcp
```

Requires Node.js >= 22.12.0 (pinned in `.nvmrc` at 22.14.0). Always runs under Node — bun cannot load `node-pty`.

## Project structure

```
packages/
  app/            # React 19 frontend (xterm.js, Zustand, Tailwind CSS v4)
  daemon/         # Express backend daemon (REST, Socket.IO, SQLite WAL, node-pty, Chair)
  bridge/         # Chairman and LLM bridge servers
  cli/            # CLI tooling (ant start/stop/status, daemon management)
  mcp/            # MCP server (stdio) for Claude Code / Cursor integration
  website/        # Marketing site (SvelteKit + Svelte 5)
```

## Key architectural decisions

- **Terminal rendering**: xterm.js v5.5.0 with WebGL addon (canvas fallback). Server-side headless xterm mirrors browser state for reconnect.
- **Transport**: Socket.IO with dedicated `/terminal` namespace using binary (Uint8Array) transport. Separate from control plane to avoid blocking.
- **Persistence**: SQLite in WAL mode. Sessions, messages, and terminal output chunks all stored.
- **Session persistence**: dtach for PTY sessions — survives browser disconnects.
- **State management**: Zustand on the frontend.
- **Themes**: 5 terminal themes (Default Light/Dark, Dracula, Solarized Dark, Nord) in `packages/app/src/themes.ts`.

## Code style

- TypeScript throughout (frontend and backend).
- Tailwind CSS v4 utility classes — avoid custom CSS.
- UK English spelling in comments, docs, and user-facing strings.
- Keep files small and focused.
- No `bun.lock` or `package-lock.json` in commits — `pnpm-lock.yaml` is the canonical lockfile.

## Environment

Copy `.env.example` to `.env`. Key vars: `ANT_PORT`, `ANT_HOST`, `ANT_TAILSCALE_ONLY`, `ANT_API_KEY`, `ANT_TLS_CERT`/`ANT_TLS_KEY`.

## Developer experience tips

When using Claude Code to work on this project, enable fullscreen rendering for a flicker-free experience — especially useful in VS Code's integrated terminal or tmux:

```bash
export CLAUDE_CODE_NO_FLICKER=1
export CLAUDE_CODE_SCROLL_SPEED=3
```

This uses the terminal's alternate screen buffer (like vim), gives mouse support, and keeps memory flat in long sessions. Use `Ctrl+o` then `/` to search the conversation, or `Ctrl+o` then `[` to dump it to native scrollback for `Cmd+f`.
