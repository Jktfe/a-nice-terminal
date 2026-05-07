# Tier-1 CLI parity matrix

Working record of where each Tier-1 CLI sits on the parity goals
(MCPs, tools, skills, plugins, hook-driven state). Implementation
work is **out of scope** for the current PR — this doc is the
reference the next initiatives build from.

Last updated: 2026-05-07.

## State-line hooks (this PR)

| CLI            | Hook surface                              | State template                             | Status |
|----------------|-------------------------------------------|--------------------------------------------|--------|
| Claude Code    | Native lifecycle hooks (settings.json)    | [hooks/claude-code/](hooks/claude-code/)   | ✅ Reference implementation, working in production |
| Codex CLI      | TOML config (`~/.codex/config.toml`)      | [hooks/codex-cli/](hooks/codex-cli/)       | 🟡 Template + bootstrap drafted; not yet verified on a live host |
| Gemini CLI     | settings.json hooks + web hooks           | [hooks/gemini-cli/](hooks/gemini-cli/)     | 🟡 Driver already supports `setHooksActive()`; template drafted |
| Qwen CLI       | Forked from Gemini (settings.json)        | [hooks/qwen-cli/](hooks/qwen-cli/)         | 🟡 Template forked from Gemini; verify settings.json path |
| Pi             | JSONL/RPC frames (no shell hooks)         | [hooks/pi/](hooks/pi/)                     | 🟡 Wrapper-emitter template; needs RPC frame audit |
| Copilot CLI    | None — wrapper script only                | [hooks/copilot-cli/](hooks/copilot-cli/)   | 🟡 Stdin/stdout wrapper template; classifier-driven |

`Menu` and `Permission` states are first-class for Claude Code;
inferred via classifier or driver heuristic for the others.

## MCPs (Model Context Protocol servers)

| CLI            | MCP support       | Notes |
|----------------|-------------------|-------|
| Claude Code    | Native            | `~/.claude/mcp.json`; full tool routing |
| Codex CLI      | Native (≥ v0.30)  | `~/.codex/config.toml` `[mcp]` section |
| Gemini CLI     | Native            | `~/.gemini/settings.json` `mcp` field |
| Qwen CLI       | Inherited from Gemini | Same config surface as Gemini |
| Pi             | Custom RPC        | Pi exposes its own RPC; MCP bridge needed |
| Copilot CLI    | Via ant-channel   | Bridge MCP through ANT's ant-channel |

**Goal**: all six can call the same set of MCPs (filesystem, search,
git, etc.). Today Claude / Codex / Gemini / Qwen have native paths;
Pi and Copilot need a bridge layer.

## Tools (built-in agent tools)

| CLI            | Pattern                            | Notes |
|----------------|------------------------------------|-------|
| Claude Code    | Built-in tool registry             | Read, Write, Edit, Bash, WebFetch, etc. |
| Codex CLI      | Built-in tool registry             | Mostly overlapping with Claude |
| Gemini CLI     | Built-in tool registry             | Smaller surface; relies more on MCPs |
| Qwen CLI       | Inherited from Gemini              | Same as Gemini |
| Pi             | Custom tool API                    | Different shape; bridge needed for parity |
| Copilot CLI    | GitHub-flavoured tools             | Different focus (GitHub Issues / PRs / Workflows) |

## Skills (system-prompt-augmenting modules)

| CLI            | Surface                               | Notes |
|----------------|---------------------------------------|-------|
| Claude Code    | `~/.claude/skills/` + plugin marketplaces | Mature ecosystem; ObsidiANT inventory at `~/.claude/skills/CLAUDE-INVENTORY.md` |
| Codex CLI      | Limited                               | No skill marketplace; manual prompt injection |
| Gemini CLI     | `~/.gemini/extensions/`               | Different shape; no Claude-Code parity yet |
| Qwen CLI       | Inherited from Gemini                 | Same as Gemini |
| Pi             | None                                  | System prompt only |
| Copilot CLI    | Limited                               | GitHub-Copilot skills are server-side |

## Plugins (lifecycle-event extensions, tool packs, command packs)

| CLI            | Surface                           | Notes |
|----------------|-----------------------------------|-------|
| Claude Code    | `/plugin install` marketplace     | Most mature; this hook system is itself a plugin |
| Codex CLI      | None today                        | Hook-via-TOML approximates the lifecycle slot |
| Gemini CLI     | Extensions API                    | Less mature than Claude's plugins |
| Qwen CLI       | Inherited from Gemini             | Same as Gemini |
| Pi             | Custom RPC                        | Plugin shape doesn't apply directly |
| Copilot CLI    | None                              | GitHub plugin model is repo-scoped, not session-scoped |

## Goals (next milestones for parity)

1. **State-line hooks installed and verified** on each Tier-1 CLI on
   at least one host. Track per-CLI in
   `hooks/<cli>/NOTES.md` "Verification" sections.
2. **MCP bridge for Pi and Copilot** — exposes the same MCP set the
   other four already speak natively.
3. **Skill-pack alignment** — when a skill exists for Claude (e.g.
   `pdf-handling`), record an equivalent path or wrapper for Gemini /
   Qwen. Pi and Copilot may not be able to consume skills directly;
   that's an acknowledged gap.
4. **Plugin equivalence** — define a "plugin spec" that translates a
   Claude plugin manifest to per-CLI config. This is the most
   speculative item — list as "future" rather than current goal.

## Why this matrix exists in two places

This file (`docs/agent-setup/parity-matrix.md`) is the **versioned
record** that ships with the codebase — a contributor cloning the
repo sees the goal state at the commit they're on.

The same content also lives in ObsidiANT (the user's vault) where
it's annotated with running notes, pairing history, and per-host
verification logs. Treat ObsidiANT as the working journal and this
file as the published reference. They drift; the canonical claims
of "what this PR ships" live here.
