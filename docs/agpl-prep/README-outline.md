# README Outline for a-nice-terminal (OSS public)

This is an outline, not the final README. The migration runbook copies this
to a-nice-terminal/README.md and fills in the bracketed sections with live
values from the migrated build.

---

# ANT — a-nice-terminal

> Room-scoped multi-agent terminal orchestrator. 
> One room. Multiple agents. Different models. Visible cost.

ANT lets you run Claude Code, Codex, Gemini CLI, Pi, Qwen, Kimi, Copilot, 
and other CLI coding agents inside shared rooms. Agents join rooms with 
humans and each other, share artefacts, and answer to a shared plan. 

ANT is the transport layer — it routes messages, not models. What each 
agent does inside its terminal is up to the agent.

## What ANT Does

| Capability | What it means |
|---|---|
| Room-scoped context | Agents don't run alone. They join rooms, share artefacts, answer to a shared plan. |
| Multi-vendor agents | Claude Code, Codex, Gemini CLI, Pi, Qwen, Kimi, Copilot, and more — all first-class. |
| Visible cost | Every agent row shows model, provider, cost tier, and tokens consumed. |
| CLI-first design | Every feature has a CLI verb. The web UI is discoverability over the CLI. |
| Self-hosted | Runs on your machine. Your terminals, your keys, your data. |

## Quick Start

```bash
# Clone and install
git clone https://github.com/Jktfe/a-nice-terminal.git
cd a-nice-terminal
bun install

# Start the server (default port 6458)
bun run dev

# Install the CLI
cd cli && bun install && bun link
ant --help
```

## Architecture

```
┌─────────────────────────────────────────┐
│              ANT Server                  │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐  │
│  │  Rooms   │ │Terminals │ │  Plans   │  │
│  └─────────┘ └──────────┘ └──────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐  │
│  │  Asks   │ │  Chair   │ │  Tasks   │  │
│  └─────────┘ └──────────┘ └──────────┘  │
│         SQLite DB  ·  SSE/WS            │
└─────────────────────────────────────────┘
         ▲                    ▲
         │                    │
    ┌────┴────┐         ┌────┴────┐
    │ ant CLI │         │ Web UI  │
    └─────────┘         └─────────┘
```

## Premium Features

ANT is open-source under AGPL-3.0. Premium native apps are available
for macOS and iOS:

- **ANT for Mac** (£5.99/mo) — Tauri desktop app with native terminal
  embedding, auto-updates, menu bar integration, and push notifications.
- **ANT Chat for iOS** (£5.99/mo) — Join rooms from your iPhone. QR
  pairing, deep-link join, and mobile-optimised room view.

See [antapp.dev](https://antapp.dev) for pricing and downloads.

## Documentation

- [AGENTS.md](AGENTS.md) — onboarding for AI coding agents
- [STYLE.md](STYLE.md) — 9-year-old-readable code conventions
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- `docs/` — design notes, agent setup walkthroughs

## License

ANT is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
See [LICENSE](LICENSE) for the full text.

Commercial licenses for proprietary embedding are available —
contact [license@antapp.dev](mailto:license@antapp.dev).
