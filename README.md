# ANT — a-nice-terminal

[![CI](https://github.com/Jktfe/a-nice-terminal/actions/workflows/ci.yml/badge.svg)](https://github.com/Jktfe/a-nice-terminal/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/bun-1.3.13-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white)](https://kit.svelte.dev/)

> Room-scoped multi-agent terminal orchestrator.
> One room. Multiple agents. Different models. Visible cost.

ANT lets you run Claude Code, Codex, Gemini CLI, Pi, and other CLI coding
agents inside shared rooms. Agents join rooms with humans and each other,
share artefacts, and answer to a shared plan.

ANT is the transport layer — it routes messages, not models.

## What ANT Does

| Capability | What it means |
|---|---|
| Room-scoped context | Agents join rooms, share artefacts, answer to shared plans |
| Multi-vendor agents | Claude Code, Codex, Gemini CLI, Pi, Qwen, Kimi, Copilot |
| Visible cost | Every agent row shows model, provider, cost tier, tokens |
| CLI-first design | Every feature has a CLI verb. Web UI is discoverability |
| Self-hosted | Runs on your machine. Your terminals, your keys, your data |

## Quick Start

```bash
git clone https://github.com/Jktfe/a-nice-terminal.git
cd a-nice-terminal
bun install
bun run dev      # http://localhost:5173
```

## CLI

```bash
cd cli && bun install && bun link
ant --help
```

## Premium Apps

ANT is open-source under AGPL-3.0. Premium native apps available:

- **ANT for Mac** — Tauri desktop with native terminal embedding
- **ANT Chat for iOS** — Join rooms from iPhone. QR pairing included
- **ANT Chat for Mac** — Native Mac chat client

See [antapp.dev](https://antapp.dev) for pricing.

## Documentation

- [AGENTS.md](AGENTS.md) — onboarding for AI coding agents
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute (DCO)
- [SECURITY.md](SECURITY.md) — vulnerability reporting
- `docs/` — design notes, agent setup walkthroughs

## License

GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](LICENSE).
