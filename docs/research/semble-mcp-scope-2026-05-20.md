# Semble MCP Scope — ANT-Owned Repos Only

This is the v1 privacy boundary for the Semble MCP integration.

## Contract

Semble may index only the explicit roots in
[`scripts/semble-ant-owned-allowlist.json`](../../scripts/semble-ant-owned-allowlist.json):

- `/Users/you/CascadeProjects/ant`
- `/Users/you/CascadeProjects/a-nice-terminal`
- `/Users/you/CascadeProjects/antchat`

It must not index broad workspace roots, memory vaults, local agent state, MCP
config, terminal transcripts, database files, environment files, or generated
artefacts.

## Operating Rule

Use Semble for exploratory cross-file discovery when the exact file path is not
known. Keep `rg` as the first choice for exact literals, filenames, and narrow
checks. Treat Semble output as a map, not the authority: open the source file
before editing.

## Why This Exists

The integration-shebang plan asked for Semble to be useful without expanding
the privacy surface. The broad `CascadeProjects/*` index is explicitly deferred.
The v1 index is ANT-owned repos only, with deny roots for vaults and local
agent config.

## Mount-Time Checklist

Before enabling Semble for any agent:

1. Load the allowlist from `scripts/semble-ant-owned-allowlist.json`.
2. Confirm every `includeRoots[].path` exists.
3. Confirm no `denyRoots[]` path is inside the index set.
4. Pin the Semble package or server version.
5. Keep existing `rg` / Read / Glob workflows available as fallback.
