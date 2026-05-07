# Hook templates — per-CLI state-line plugins

This directory contains the canonical hook templates each Tier-1 CLI installs
into its own user-config directory to write the unified state file consumed
by ANT.

The contract is the JSON Schema at `../state-schema.json`. Each CLI writes to
`$HOME/.ant/state/<cli>/<session_id>.json` (preferred) or its legacy per-CLI
location for back-compat. ANT reads via `src/fingerprint/agent-state-reader.ts`.

## Structure

Each subdirectory contains:

- **`template.sh`** — the actual hook scripts (or the body of the inline
  hook command), with `${HOME}` and `${SESSION_ID}` placeholders. These are
  ANT-shared and versioned in this repo. No personal paths or credentials.
- **`bootstrap-prompt.md`** — a self-contained prompt the user pastes into
  the target CLI. The CLI reads its own template + the schema, then installs
  the hook into its own config dir bound to the local host. ANT itself does
  not ship an installer; per-CLI personal hook copies stay out of the repo.
- **`NOTES.md`** — events that CLI exposes, how they map to the unified
  `state` enum, and any quirks (Gemini's web hooks, Codex's pre/post-tool
  ordering, etc.).

## CLIs

| CLI            | Template directory          | Status |
|----------------|-----------------------------|--------|
| Claude Code    | [claude-code/](claude-code/)| Reference implementation; written this session |
| Codex CLI      | [codex-cli/](codex-cli/)    | Hook surface: `~/.codex/hooks/` (TOML config) |
| Gemini CLI     | [gemini-cli/](gemini-cli/)  | Hook surface: `~/.gemini/settings.json` (also web hooks) |
| Qwen CLI       | [qwen-cli/](qwen-cli/)      | Hook surface: similar to Gemini per upstream parity |
| Pi             | [pi/](pi/)                  | JSONL/RPC structured integration |
| Copilot CLI    | [copilot-cli/](copilot-cli/)| Shell hooks via wrapper |

## Why state files instead of MCP / direct ANT sockets

State files are:

1. **Decoupled** — the CLI doesn't need to know ANT exists. ANT tails the
   files; the CLI just records its lifecycle as text.
2. **Cheap** — no LLM tokens, no socket churn, no auth handshake.
3. **Inspectable** — `cat $HOME/.ant/state/claude-code/*.json` is the entire
   debugging surface.
4. **Survivable** — if ANT crashes, the state file remains. When ANT
   restarts, it picks up the latest snapshot.

See `docs/LESSONS.md` § 1.12 for the original design rationale.
