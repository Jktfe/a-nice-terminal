# Kimi Code CLI Notes

Research date: 2026-04-27
Local status: `kimi` is not installed locally.

Official documentation findings:

- Kimi Code CLI is a terminal coding agent with shell command mode, MCP support, and ACP support.
- `kimi --print -p "..." --output-format=stream-json` emits JSONL.
- Print-mode JSONL uses a message format with `role`, `content`, optional `tool_calls`, and `tool` result messages.
- `kimi --input-format=stream-json --output-format=stream-json` can continuously read JSONL messages from stdin until stdin closes.
- `kimi acp` starts a multi-session Agent Client Protocol server.
- Kimi supports `--continue`, `--session`, and `--resume`.
- Kimi has Wire mode, but it is experimental and separate from normal shell/print/ACP UI.

ANT recommendation:

- Do not install or depend on Kimi yet.
- When installed, first probe `kimi --print --output-format=stream-json` and `kimi acp`.
- If ACP behaves well, it is the preferred structured path; otherwise stream-json print mode can support headless tasks.
- For persistent human-visible sessions, keep tmux PTY as the default lane until Kimi ACP has been proven in ANT.
