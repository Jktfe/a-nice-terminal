# Superpowers Adapter Policy

`AGENTS.md` is the ANT vNext project contract. CLI-specific files are adapters
that explain how that CLI should find the same project contract and the pinned
Superpowers runtime input.

Rules:

- Do not symlink `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, `QWEN.md`,
  `COPILOT.md`, or `PI.md` directly to `AGENTS.md`.
- Keep adapter files short. Put shared project rules in `AGENTS.md`.
- Keep upstream Superpowers content pinned through
  `superpowers/sync-manifest.json`.
- Use `.ant-runtime/superpowers/current` as the local runtime mirror after
  running `bun run superpowers:sync -- --write`.
- Run `bun run superpowers:drift` before claiming the terminal skill/tool set is
  current.
- If a future change copies upstream content into tracked source, add a source
  note with upstream path, commit, and the ANT simplification made here.
