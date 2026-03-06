# Contributing to ANT

Thanks for your interest in contributing to ANT. This guide covers the essentials for getting started.

## Development Setup

### Prerequisites

- Node.js >= 22.12.0
- [Bun](https://bun.sh) package manager
- macOS, Linux, or WSL

### Getting Started

```bash
git clone https://github.com/Jktfe/a-nice-terminal.git
cd a-nice-terminal
bun install
bun run dev
```

The development server starts at `http://127.0.0.1:3000` with Vite HMR enabled.

### macOS Sequoia Note

On macOS Sequoia (15.x) and later, `node-pty` must be compiled from source. The `bun install` step handles this automatically via `node-gyp`, but you may need Xcode Command Line Tools installed:

```bash
xcode-select --install
```

If you encounter build errors related to `node-pty`, ensure your Xcode tools are up to date and that `node-gyp` is available (it is included as a dev dependency in the root workspace).

## Code Style

- **TypeScript** throughout -- both frontend and backend.
- **Tailwind CSS v4** for styling. Use utility classes; avoid custom CSS where possible.
- Run `bun run lint` (which executes `tsc --noEmit`) to type-check before submitting.
- Keep files focused and small. The codebase favours many small modules over large monolithic files.
- Use UK English spelling in comments, documentation, and user-facing strings.

## Project Structure

```
packages/
  app/          # Main application
    src/        # React frontend (components, store, styles)
    server/     # Express backend (routes, middleware, WebSocket handlers, DB)
  mcp/          # MCP server for AI agent integration
  website/      # Marketing website (SvelteKit + Svelte 5)
```

## Pull Request Process

1. **Fork and branch** -- create a feature branch from `main` (e.g. `feature/my-change` or `fix/issue-description`).
2. **Make your changes** -- keep commits focused. One logical change per commit.
3. **Type-check** -- run `bun run lint` and ensure there are no errors.
4. **Open a PR** -- provide a clear description of what the change does and why. Reference any related issues.
5. **Review** -- a maintainer will review your PR. Be prepared to make adjustments based on feedback.

## Reporting Issues

Open an issue on GitHub with:

- A clear title and description
- Steps to reproduce (if it is a bug)
- Your environment (OS, Node.js version, browser)

## Licence

By contributing, you agree that your contributions will be licensed under the [MIT Licence](./LICENSE).
