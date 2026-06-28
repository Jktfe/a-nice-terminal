# Qwen Code Adapter

Read `AGENTS.md` first. It is the canonical ANT vNext project contract.

Qwen project skills should be generated from the pinned Superpowers manifest,
not pasted by hand from GitHub. The local mirror lives at
`.ant-runtime/superpowers/current` after:

```sh
bun run superpowers:sync -- --write
```

If a future Qwen project-local `.qwen/skills` tree is committed, record the
upstream commit and keep `bun run superpowers:drift` green.
