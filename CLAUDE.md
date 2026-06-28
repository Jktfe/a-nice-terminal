# Claude Code Adapter

Read `AGENTS.md` first. It is the canonical ANT vNext project contract.

Superpowers are pinned in `superpowers/sync-manifest.json` and mirrored locally
under `.ant-runtime/superpowers/current` after running:

```sh
bun run superpowers:sync -- --write
```

Use the Claude-specific upstream adapter root from the manifest
(`.claude-plugin`) only through the local mirror. This file is intentionally not
a symlink to `AGENTS.md`; Claude-specific setup belongs here, while shared repo
rules stay in `AGENTS.md`.
