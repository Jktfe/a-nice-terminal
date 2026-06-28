# Superpowers Sync

ANT keeps repo policy in `AGENTS.md`. Superpowers are a pinned external
runtime input, not the canonical project instructions.

Current source:

- repo: `https://github.com/obra/Superpowers.git`
- branch: `main`
- pinned commit: `b62616fc12f6a007c6fd5118146821d748da0d33`
- manifest: `superpowers/sync-manifest.json`

The sync script compares the pinned upstream roots with the local runtime
mirror at `.ant-runtime/superpowers/current`. That mirror is intentionally
ignored by Git so a large external tree does not enter this repo by accident.

Commands:

```sh
bun run superpowers:drift
bun run superpowers:sync -- --write
```

`superpowers:drift` is read-only and exits non-zero when either upstream `main`
has moved past the pinned commit or the local mirror differs from the pinned
tree. `--write` refreshes only `.ant-runtime/superpowers/current`.

Thin adapter files such as `CLAUDE.md` and `GEMINI.md` should point back to
`AGENTS.md` and this manifest. They should not be blind symlinks because each
CLI discovers project instructions, plugins, hooks, and skills differently.
