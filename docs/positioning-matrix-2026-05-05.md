# ANT Positioning Matrix

Date: 2026-05-05
Status: Draft 1 — claude-authored, awaiting critic provocation responses (Gemini + Kimi) and codex review.

## Why This Document Exists

James asked for an honest open-source positioning assessment for ANT. The risk is pattern-matching to whichever tool was last mentioned (kanwas, tinyfish, sloppy). This matrix forces the comparison wider — across multi-agent orchestrators, autonomous engineers, AI IDEs, agentic terminals, cloud sandboxes, collab knowledge tools, workflow engines, terminal multiplexers, enterprise AI suites, MCP marketplaces, and passive context-capture tools.

## Axes

Six axes, all binary or short ordinal:

- **Locality**: Cloud / Local-first / Hybrid.
- **Agents**: Single / Many.
- **Multiplayer**: Solo only / Single-user multi-agent / Multi-human + agents.
- **Terminal-native**: No / Yes.
- **Evidence/provenance**: None / Logs only / Durable durable-with-hashes.
- **Openness**: Closed / Open-source / Open-source + paid hosted.

## Tool Survey

### Multi-agent orchestrators

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| AutoGen (v0.4) | Local + cloud | Many | Single-user | No | Logs | OSS |
| AutoGen Studio | Local | Many | Single-user | No | Logs | OSS |
| CrewAI | Local + cloud | Many | Single-user | No | Logs | OSS + paid |
| LangGraph | Local | Many | Single-user | No | Logs | OSS + paid |
| MetaGPT | Local | Many | Single-user | No | Files+logs | OSS |
| ChatDev | Local | Many | Single-user | No | Files+logs | OSS |
| OpenAI Swarm | Local | Many | Single-user | No | None | OSS |
| AgentScope | Local | Many | Single-user | No | Logs | OSS |
| Sloppy | Local | Many | Single-user | No | Typed events | OSS (very young) |

Common shape: Python (or Swift in Sloppy's case), library-driven, results consumed via notebook or script. None are terminal-native. None are multi-human. Most have no durable evidence pipeline beyond log lines.

### Autonomous engineers

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| Devin | Cloud | Single (with subagents) | Solo | No (cloud workspace) | Workspace artifacts | Closed |
| OpenHands (ex-OpenDevin) | Local + cloud | Single (orchestrator + tools) | Solo | Container shell | Files+events | OSS |
| SWE-agent | Local | Single | Solo | Container shell | Trajectory files | OSS |
| Replit Agent | Cloud | Single | Solo | Replit shell | Replit project state | Closed (free tier) |
| Bolt.new | Cloud | Single | Solo | WebContainer shell | Project state | OSS-engine + closed UI |
| Lovable | Cloud | Single | Solo | No | Project state | Closed |
| v0.dev | Cloud | Single | Solo | No | Component snippets | Closed |

Common shape: solo human + one autonomous agent inside a sandbox. Output is a working app or PR. No notion of multiple humans, no notion of multiple cooperating agents the user can watch in parallel.

### AI terminals + AI IDEs

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| Cursor | Local | Single (composer + chat) | Solo | Editor terminal | Chat history | Closed |
| Windsurf | Local | Single | Solo | Editor terminal | Chat history | Closed |
| Zed AI | Local | Single | Solo (collab edit possible) | Editor terminal | Chat history | OSS + paid |
| Continue.dev | Local | Single | Solo | Editor | Chat history | OSS |
| Aider | Local | Single | Solo | Terminal | Git diffs | OSS |
| Claude Code (CLI) | Local | Single | Solo | Yes | Chat + tool transcript | Closed |
| Codex CLI | Local | Single | Solo | Yes | Chat + tool transcript | OSS engine + closed runtime |
| Warp | Local | Single | Solo | Yes | Command history | Closed (free tier) |
| Wave Terminal | Local | Single | Solo | Yes | Command history | OSS |

Common shape: one human + one AI inside an IDE or terminal. Strong evidence inside the editor surface, weak evidence outside it. None of these expose "five live agents in five panes, talking to each other" as a first-class experience. The closest is Wave's tab system, but the AI is still per-tab.

### Cloud sandboxes / dev-boxes

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| GitHub Codespaces | Cloud | Single (or BYO via tools) | Single-user | Yes | Repo state | Closed (paid) |
| e2b | Cloud | Single (sandbox per session) | Single-user | Yes | Sandbox state | OSS + paid |
| Daytona | Cloud + self-host | Single-user | Single-user | Yes | Workspace state | OSS + paid |
| DevPod | Local + cloud | Single-user | Single-user | Yes | Workspace state | OSS |
| Modal | Cloud | Single | Single-user | Function-level | Run logs | OSS SDK + paid |

Common shape: one sandbox per session, agents are tenants of the sandbox. Multi-agent doesn't mean five agents in one sandbox; it means five sandboxes side by side, with no shared room. Cross-machine teammate collaboration is non-existent — sandboxes are per-user.

### Collab knowledge tools (with AI bolted on)

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| Notion AI | Cloud | Single (Q+A on page) | Multi-human | No | Page edits | Closed |
| Tana | Cloud | Single (per-node) | Multi-human | No | Block history | Closed |
| Granola | Local + cloud | Single (meeting-scoped) | Solo or shared | No | Transcripts + notes | Closed |
| Affine | Local-first | Limited | Multi-human | No | Block history | OSS |
| Logseq | Local | None native | Solo (with sync) | No | Block history | OSS |
| Reflect | Cloud | Single | Solo | No | Notes | Closed |

Common shape: humans collaborate, AI assists at the page-or-block level. No agents drive sustained work. No terminal. Evidence lives only inside the docs surface.

### Workflow engines (used by agent runtimes)

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| Temporal | Self-host or cloud | Workflow primitive | N/A | No | Workflow events | OSS + paid |
| Inngest | Cloud + self-host | Workflow primitive | N/A | No | Step events | OSS + paid |
| Trigger.dev | Cloud | Workflow primitive | N/A | No | Run logs | OSS + paid |
| n8n | Self-host or cloud | Workflow nodes | N/A | No | Run logs | OSS + paid |
| Pipedream | Cloud | Workflow steps | N/A | No | Run logs | Closed (paid) |

These are infrastructure, not products. They underpin durability (Sloppy uses Temporal, modern agent runtimes lean on Inngest). ANT's run_events table is a lightweight Inngest-shaped log without the durability primitives.

### Terminal multiplexer ancestors

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| tmux | Local | None | Single-user (shared via socket) | Yes | Scrollback only | OSS |
| Zellij | Local | None | Single-user | Yes | Scrollback + plugin events | OSS |
| screen | Local | None | Single-user | Yes | Scrollback only | OSS |
| mosh | Local | None | Single-user | Yes | None | OSS |

ANT is fundamentally a chat-aware tmux-with-evidence. tmux + a custom orchestrator script can already do "five agents in five panes". What it cannot do natively: route messages by handle, retain durable evidence, expose a multi-human chat layer, surface decisions/asks, or give agents a stable identity across reconnects.

### Enterprise AI suites

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| Microsoft Copilot Studio | Cloud | Many (declarative agents) | Multi-human (org) | No | Org logs | Closed (paid) |
| Salesforce Agentforce | Cloud | Many | Multi-human (org) | No | Org logs | Closed (paid) |
| Slack + AI bots | Cloud | Many | Multi-human | No | Slack history | Closed (paid) |

Common shape: agents inside a chat UI, agents inside a CRM. Cross-agent visibility is shallow; agents are mostly request/response. No notion of long-running terminal-driven work.

### MCP marketplaces / federation

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| Smithery | Cloud directory | N/A | N/A | N/A | N/A | Open directory |
| mcp.so | Cloud directory | N/A | N/A | N/A | N/A | Open directory |
| Anthropic skills marketplace | Cloud | N/A | N/A | N/A | N/A | Closed (Claude only) |

These are tool ecosystems, not products. ANT integrates with MCP but does not yet ship its own marketplace.

### Passive context capture

| Tool | Locality | Agents | Multiplayer | Terminal-native | Evidence | Openness |
|------|----------|--------|-------------|-----------------|----------|----------|
| Granola | Local + cloud | Limited | Solo + share | No | Transcripts | Closed |
| Rewind | Local | None native | Solo | No | Screen + audio | Closed |
| Reflect | Cloud | Single | Solo | No | Notes | Closed |

Useful as a comparison for "evidence pipeline" shape. Granola's "every meeting becomes a structured artifact" maps to ANT's "every chat/terminal session becomes a deck/asks/run-events trail" — but Granola is single-stream where ANT is multi-stream.

## Where ANT Sits On Each Axis

| Axis | ANT today |
|------|-----------|
| Locality | Local-first. Tailscale-exposed for cross-device same-user. Cross-machine teammate endpoint not yet built. |
| Agents | Many. 14 CLI agents wrappable; 6 cloud + ~3 local commonly used. |
| Multiplayer | Single-user multi-agent. Multi-human roadmap not started. |
| Terminal-native | Yes — terminals are first-class entities, not editor side-panels. |
| Evidence | Durable with hashes. Surfacing system + Open-Slide manifest are the strongest in this set. |
| Openness | Pre-OSS. Codebase exists; no public release; unpaid. |

## Honest Comparisons

### Where ANT looks like fancy tmux + Slack + Notion AI

A power user with `tmux + tmuxinator + claude --dangerously-skip-permissions + Slack + Notion + Granola` can today get:
- Multiple agents in panes (tmux).
- Logged history (scrollback).
- Cross-room chat (Slack).
- Shared notes (Notion).
- Decisions captured (Granola or Notion).

What that stack cannot do without ANT-shaped glue:
- Route a message to "@codex" and have one specific agent get it.
- Retain a deterministic deck export with provenance hash.
- Auto-detect interactive prompts and surface them as asks.
- Replay an agent's command history with run-event correlation.
- Coordinate identity by PID-tree so an agent in any pane knows who it is.

Most of these are stitched primitives, not novel research. The novelty is in the *combination*, not in any single piece.

### Where ANT looks genuinely novel

Three places, in order of how confident the claim is:

1. **Terminal-native multi-agent + chat fan-out + durable evidence as one substrate.** No tool surveyed does all four. AutoGen has multi-agent, Cursor has IDE-native, Granola has evidence pipeline, Slack has chat fan-out. ANT puts them under one roof, and the agents are *real terminals* not API stubs — which is what makes Codex CLI / Claude Code / Codex CLI all just-work.
2. **PID-tree identity routing.** Agents identify themselves by walking process.ppid and matching against a registry. No comparable tool needs this because no comparable tool has multiple AI CLIs as first-class entities. Whether anyone but James will ever benefit from this is a real open question.
3. **Open-Slide as evidence-as-output.** Decks-as-React-bundles with a manifest, audit log, and conflict guard, exported deterministically from chat evidence. Closest comparison is Bolt.new's "generate an app from a prompt" but Bolt has no provenance, no manifest, no replay. Granola exports docs but not interactive decks.

### Where ANT is straightforwardly behind

- **Visual generation lane** is Gemini-shaped today and Gemini is not delivering. v0/Bolt/Lovable beat us on UI gen quality. Cursor + Claude beat us on visual-verification loops.
- **Autonomous coding** is hit-or-miss vs Devin / OpenHands / Replit Agent on green-field tasks.
- **No multi-human story.** Notion / Slack / Affine all assume multiple humans. ANT does not.
- **No marketplace.** Smithery and Anthropic's skills directory beat us on tool discovery.
- **No durable workflow primitive.** Sloppy + Temporal beat us on long-running task supervision; we have run_events but not retries / compensations / long-running state machines.
- **Dashboard nav friction.** James's own field note: too many clicks back to context. Cursor's command palette and Warp's launch configs are smoother.

## What James's Field Notes Add

From the 2026-05-05 conversation, captured for slide content:

- **Turn-taking primitive needed.** Three modes: race (current default), round-robin (turn token), ping-pong (alternate). Visible quick-release in chat header. This is a real product feature, not just process discipline.
- **Per-agent strengths:** Claude = logic but jumps too fast; Codex = momentum but needs a nudge loop; Gemini = visual lane occupant but not delivering; Gemma local = strong on discrete jobs, under-used.
- **Codex+ollama cloud** is an unexpected positive — worth doubling down on cloud-routed local models for cost.
- **Local-agent dispatch** is under-used. Discrete jobs (the felt-templates work) belong on Gemma, not Claude/Codex.
- **Visual-agent gap.** Replacement bets to cost: v0 / Bolt for UI generation; Claude with Chrome MCP + computer-use for visual verification; Pencil MCP for design-file work.

## Open Questions For The Critics (Gemini, Kimi, DeepSeek)

The same provocation goes to each, no warm-up:

1. Where is ANT just a fancier tmux + a chat panel? Which parts of its stated value could a power user already cobble together with tmux, Claude Code, Slack, and Notion in an evening?
2. Where, if anywhere, does ANT do something genuinely novel — something AutoGen, CrewAI, LangGraph, OpenHands, Devin, Cursor, Warp, Replit Agent, e2b, or Notion AI does not already do?
3. If you were James's collaborator and he offered to install ANT on your machine for cross-machine agent-to-agent collaboration, what is the single most likely reason you would say no, and what would change your mind?

Be terse. Pretend you are charged per word. Be honest, not encouraging.

## Pre-Commitment Before Reading Replies

Before reading the critic responses, my best guess at the honest answer is:

- **Just for me + my team:** 80% likely if the cross-machine teammate endpoint never gets built. ANT then is a really good personal cockpit, not a product.
- **Genuinely worth open-sourcing:** 60% likely. The terminal-native multi-agent substrate is rare enough that someone else who wants the same shape will find it valuable. The risk is that "someone else" is a small population of LLM-power-users, not a market.
- **Wasted time:** below 20%. Even the worst case yields a strong personal tool plus reusable primitives (Open-Slide manifest, surfacing system, prompt-bridge) that have value alone.

I'll re-score these after critic synthesis.
