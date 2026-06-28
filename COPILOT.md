# GitHub Copilot CLI Adapter

Read `AGENTS.md` first. It is the canonical ANT vNext project contract.

Copilot CLI should use the same pinned Superpowers source as the other terminal
lanes. The manifest is `superpowers/sync-manifest.json`; the local runtime
mirror is `.ant-runtime/superpowers/current`.

Do not point Copilot setup at a moving GitHub branch at runtime. Refresh with:

```sh
bun run superpowers:sync -- --write
```
