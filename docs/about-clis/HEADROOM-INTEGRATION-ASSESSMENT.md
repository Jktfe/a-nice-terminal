# Headroom, Pigtail, Memory, MemPalace, and Semble Integration Assessment

Date: 2026-06-19
Owner: Codex
Room source: ANT fixes `msg_04205jfy8f`

## Sources Checked

- Headroom upstream: https://github.com/chopratejas/headroom at `9f7f3ad`.
- Headroom docs in the same checkout: `docs/content/docs/architecture.mdx`,
  `ccr.mdx`, `mcp.mdx`, `memory.mdx`, `failure-learning.mdx`,
  `filesystem-contract.mdx`, `configuration.mdx`, and `limitations.mdx`.
- Local ANT context: `scripts/ant-cli-brief.mjs`,
  `scripts/semble-ant-owned-allowlist.json`, and
  `static/integrations-2026-05-19.html`.
- Pigtail: no unique source was found by local search or targeted GitHub/web
  search. Do not add a pigtail dependency until the exact repository or package
  URL is supplied.

## Headroom Facts

Headroom is an Apache-2.0 context compression layer with Python package
`headroom-ai` version `0.26.0` and a TypeScript SDK package also named
`headroom-ai`.

It exposes these integration shapes:

- Proxy: `headroom proxy --port 8787`.
- MCP: `headroom_compress`, `headroom_retrieve`, and `headroom_stats`.
- Wrappers: `headroom wrap claude|codex|cursor|aider|copilot`.
- SDKs: Python and TypeScript.

The core idea is CCR, or compress-cache-retrieve: compress large context, store
the original locally, and let the model retrieve the original by hash. That is
the right lesson for ANT because it preserves truth while reducing active
context.

Important limits and risks:

- The TypeScript `compress()` path calls a running Headroom proxy. It is not a
  pure in-process compressor.
- Default proxy telemetry is on. ANT integration must set
  `HEADROOM_TELEMETRY=off` unless the operator explicitly enables telemetry.
- Headroom writes runtime state under `~/.headroom` by default. ANT should set
  explicit `HEADROOM_CONFIG_DIR` and `HEADROOM_WORKSPACE_DIR`.
- Python extras can pull large optional dependency trees. ANT should start with
  the smallest useful install: MCP or proxy, not `[all]`.
- Headroom's own docs say source code is mostly passed through by default, which
  is the correct safety posture for coding agents.

## What ANT Should Learn

1. Reversible compression beats summaries for agent handoff.

   ANT should not throw away transcripts, room history, search output, or tool
   output just to fit a context window. It should hand agents a compressed view
   with a durable retrieval pointer back to the original.

2. Compression should sit beside the memory system, not replace it.

   Current ANT already has separate lanes:

   - room history;
   - Markdown memory packs / room memory;
   - MemPalace as a possible external memory layer;
   - disposable terminal briefs under `~/.ant/scratch`;
   - Semble for scoped code search.

   Headroom belongs as a context transport layer between those lanes and the
   model. It should not become the source of truth for memory.

3. Failure learning is valuable, but writes must be reviewed.

   `headroom learn` writes marked sections into files like `CLAUDE.md` and
   `AGENTS.md`. ANT should copy the pattern of marker-bounded updates and
   evidence-linked lessons, but route them through ANT's existing staged memory
   promotion flow. Directly letting an external learner rewrite canonical
   project instructions is too risky.

4. Cross-agent stats are product-useful.

   Headroom's MCP stats aggregate compression/retrieval activity across
   subagents. ANT should expose similar per-room/per-terminal stats in its own
   diagnostics, even if the first implementation only reads Headroom's stats.

5. The right Semble relationship is clear.

   Semble remains the code discovery layer. Headroom can shrink large Semble
   result sets and attach retrieve hashes. It should not replace Semble's
   indexing or ranking.

## Recommendation

Implement Headroom as an optional sidecar integration, not a hard runtime
dependency.

Do not route production ANT server requests through Headroom yet. Do not wrap
every local agent by default yet. Start with an explicit, reversible proof:

### Slice A: Headroom Probe and Policy

- Add an ANT-side probe command that checks whether `headroom` is installed,
  reports version, license, telemetry state, proxy health, and MCP tool
  availability.
- Refuse "ready" unless telemetry is disabled or explicitly acknowledged.
- Use an ANT-owned workspace root, for example:
  `HEADROOM_WORKSPACE_DIR=~/.ant/headroom`.
- Record the result in diagnostics.

### Slice B: Room Artifact Compression Experiment

- Add an opt-in command or server utility that compresses one large room-safe
  artifact through Headroom MCP or proxy.
- Store:
  - compressed text;
  - original byte/token counts;
  - retrieval hash;
  - source room/artifact id;
  - expiry/retention.
- Provide an ANT retrieval command that fetches the original through Headroom
  when the hash is still live.
- Do not use this for secrets or terminal scrollback until auth boundaries and
  retention are verified.

### Slice C: Agent Handoff Packets

- Use Headroom only for generated handoff packets:
  "what happened, links, changed files, evidence, open loops."
- Keep original sources in ANT room history, terminal run events, memory pack,
  or artifact storage.
- Include retrieve links or commands in the handoff so the next agent can expand
  detail on demand.

### Slice D: Failure-Learning Staging

- Run `headroom learn` only in dry-run mode first.
- Convert candidate learnings into ANT staged memory candidates.
- Require normal ANT promotion/review before any write to `AGENTS.md`,
  `CLAUDE.md`, `CODEX.md`, `PI.md`, or other instruction files.

## Dependency Position

For now:

- `headroom`: DEFER hard dependency; CHANGE to optional sidecar/probe.
- `pigtail`: UNKNOWN until exact source is identified.
- `mempalace`: keep as external/verbatim memory candidate, not replaced by
  Headroom.
- `semble`: keep scoped code search; feed large outputs into a reversible
  compression layer only after a probe proves value.

## First Implementation

Build `ant integrations headroom status --json` first. The initial probe is
implemented in `scripts/ant-cli-integrations.mjs`.

Expected output:

```json
{
  "installed": true,
  "version": "0.26.0",
  "license": "Apache-2.0",
  "telemetry": "off",
  "workspaceDir": "~/.ant/headroom",
  "proxy": { "healthy": true, "url": "http://127.0.0.1:8787" },
  "mcp": { "available": true, "tools": ["headroom_compress", "headroom_retrieve", "headroom_stats"] },
  "recommendation": "ready_for_opt_in_artifact_probe"
}
```

This is reversible, observable, and does not place a new process in the
critical path. Once this probe exists, the next slice can test compression on
bounded room artifacts and Semble result sets.
