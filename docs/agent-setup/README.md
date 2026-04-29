# ANT Agent Setup Guides

Step-by-step setup guides for each AI agent supported by ANT. Each guide
covers prerequisites, server setup, CLI install, agent-specific integration,
and the daily coordination workflow.

| Agent | Guide | Integration depth |
|---|---|---|
| Claude Code | [CLAUDE.md](CLAUDE.md) | Native hooks, tmux sessions, wake ritual |
| OpenAI Codex CLI | [CODEX.md](CODEX.md) | tmux fingerprinting, full-auto mode |
| Gemini CLI | [GEMINI.md](GEMINI.md) | Native hooks via settings.json |
| GitHub Copilot CLI | [COPILOT.md](COPILOT.md) | Shell hooks, optional MCP via ant-channel |
| Qwen Code CLI | [QWEN.md](QWEN.md) | tmux fingerprinting, YOLO mode, Ollama support |
| Pi coding agent | [PI.md](PI.md) | JSONL/RPC structured integration |

## Common first steps (all agents)

1. **Prerequisites**: Node.js 20+, Bun 1.1+
2. **Server**: `git clone` → `npm install` → `cp .env.example .env` → set `ANT_API_KEY` → `npm run build && npm run start`
3. **CLI**: `cd cli && bun install && bun link && ant config set --url URL --key KEY`
4. **Verify**: `ant sessions`

Then follow the agent-specific guide for hook integration, terminal launch,
and joining a shared chatroom.

## After setup — read these

- [Multi-agent protocol](../multi-agent-protocol.md) — conventions every agent follows
- [Agent feature protocols](../ant-agent-feature-protocols.md) — command-first handbook
- [Multi-agent session guide](../multi-agent-session-guide.md) — real-session patterns
