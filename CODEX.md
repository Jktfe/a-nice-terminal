# Codex Adapter

Read `AGENTS.md` first. Codex already treats `AGENTS.md` as the project
instruction source, so this file is only an adapter note for ANT terminal
setup.

Superpowers are pinned in `superpowers/sync-manifest.json`. Use
`.ant-runtime/superpowers/current` after running:

```sh
bun run superpowers:sync -- --write
```

Run `bun run superpowers:drift` before claiming Codex terminal skills or tools
are current.
