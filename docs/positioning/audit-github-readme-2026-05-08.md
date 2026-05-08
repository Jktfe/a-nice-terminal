# GitHub README positioning audit

Date: 2026-05-08
Plan: `ant-positioning-launch-2026-05-08`
Milestone: `m2-audit-readme`
Owner: `@evolveantcodex`

## Scope

This audit covers the public GitHub/docs surface in this repo:

- `README.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `SKILLS.md`
- `cli/README.md`
- `antchat/README.md`
- `docs/multi-agent-session-guide.md`
- `docs/multi-agent-protocol.md`
- `docs/CHAT-BREAK.md`
- `docs/ANT-PLANNING-SKILL.md`
- `docs/LESSONS.md`
- `docs/positioning-matrix-2026-05-05.md`

It deliberately excludes `antonline.dev`; that is lane A.

## Current read

The repo already contains the substance of the pitch, but the README still
opens like an engineer-facing architecture document:

- The current headline is useful: "the missing layer between I have 13 AI CLIs
  and they actually work together."
- The first paragraph accurately says ANT coordinates Claude Code, Gemini,
  Codex, Copilot, Qwen, Pi, Hermes, Ollama, and more through shared terminal
  sessions, persistent chat, and convention-based coordination.
- The strongest market claim is present but buried: "Radically lower token
  cost" appears as one bullet in "What makes it different".
- The multi-human story exists in `antchat/README.md`, but the root README
  does not yet lead with "your agent and your colleague's agent can work in the
  same room."
- The newest proof points are absent: plan-as-shared-truth, chat-break bounded
  context, room-scoped artefacts, site tunnels, interview-lite, and task
  provenance.

The docs are operationally strong. They are not yet packaged as an OSS product
story.

## Positioning gaps

### 1. Hero should lead with the outcome, not the substrate

The current README leads with "self-hosted agent orchestrator". That is true,
but weaker than the story proven this week:

> ANT lets humans and their AI agents work in the same room, route work to the
> right agent, keep plans/tasks/evidence visible, and spend far fewer tokens on
> coordination.

Recommended hero rewrite:

- Headline: `The coordination layer for agent teams`
- Subhead: `Run Claude Code, Codex, Gemini, Copilot, local models, and remote
  collaborators in one shared room. ANT keeps plans, tasks, evidence, context
  windows, and artefacts visible without turning every agent into a token-burning
  framework participant.`

### 2. The token-savings mechanism needs its own section

James's field notes are the public objection-handler:

- Heavy week of usage did not touch limits.
- The expected fear was "more agents and duplicated messages will burn tokens."
- In practice, ANT kept usage low because the CLI/chat substrate carries
  coordination state outside the model prompt.
- Quality improved because the right agent could own the right slice.

The docs already support the mechanism:

- `docs/LESSONS.md` explains CLI/SQL vs MCP schema tax, zero-LLM background
  work, and PTY text routing.
- `docs/multi-agent-session-guide.md` explains no MCP tool tax, no polling
  loops, no system prompt bloat.
- `docs/CHAT-BREAK.md` explains bounded context windows and per-room long
  memory.

Recommended README section:

`## Why it saves tokens instead of burning them`

Bullets:

- Coordination lives in SQLite, plans, tasks, artefacts, and chat, not in every
  agent prompt.
- `@handle` routing wakes only the agents that need to work.
- `/break` creates a fresh agent context window for long-running rooms.
- Local/cheaper agents can take mechanical lanes while expensive agents keep
  the reasoning lanes.
- Plans and tasks replace repeated re-briefing.

Avoid presenting James's field notes as a benchmark. Phrase them as "field
note from real use" unless/until we add measured telemetry.

### 3. Multi-human collaboration is the clearest use case

The strongest current story is James + Mark:

- Mark used Claude Desktop + antchat on his Mac.
- James's agent and Mark's agent worked in the same room.
- The output landed in less than half the usual time because no one had to
  email, chase context, or ask whether an invoice/email had arrived.

Root README should make this a first-class use case, not a sidebar:

- "Work with your colleague's agent without forwarding context."
- "Invite someone with antchat; they do not need to run an ANT server."
- "Their Claude Desktop can join as an MCP-backed room participant."

The proof surface is already in `antchat/README.md`; the root README needs to
pull it up.

### 4. Quick Start stops before the first useful workflow

Current Quick Start gets a host running. It does not show the user why ANT is
useful in the first five minutes.

Recommended M7 shape:

1. Clone/install/build/start.
2. Configure CLI.
3. Create a room.
4. Post a message.
5. Create a plan or task.
6. Use `/break` or `Long memory` to show context control.
7. Invite a collaborator with `antchat` or wire Claude Desktop via MCP.

This should be either a compact root README section plus a linked doc, or a
new `docs/quickstart-agent-team.md` if the root README becomes too long.

### 5. Contributor docs have stale runtime commands

`CONTRIBUTING.md` says:

```bash
npm install
npm run build
npm run start
```

The repo now pins Bun (`packageManager: bun@1.3.13`) and the rest of the docs
use:

```bash
bun install
bun run build
bun run start
```

This is a small but public-facing fix.

### 6. Root README should link the newest feature docs

The README feature list mentions Plan View, but does not link the planning
skill or Chat Break docs. Add links where they fit:

- Plan View -> `docs/ANT-PLANNING-SKILL.md`
- Chat Break / bounded context -> `docs/CHAT-BREAK.md`
- Multi-agent session guide -> `docs/multi-agent-session-guide.md`
- antchat collaborator client -> `antchat/README.md`

### 7. Avoid linking stale positioning caveats as current truth

`docs/positioning-matrix-2026-05-05.md` is still useful background, but it says
ANT is "pre-OSS" and has "no multi-human story". Both are now stale. Do not
feature-link it from the README without either:

- a superseded header, or
- a new 2026-05-08 positioning doc that captures the newer proof points.

## Recommended edit order

1. Root `README.md`: rewrite hero + add "why it saves tokens" + add use-case
   strip + improve quickstart links.
2. `CONTRIBUTING.md`: Bun command correction.
3. `docs/quickstart-agent-team.md`: only if the README quickstart gets too
   long; otherwise keep M7 in the root README.
4. `antchat/README.md`: optional small line connecting antchat to the
   multi-human value prop.
5. Avoid editing deep historical docs unless a stale statement is linked from
   the new public path.

## Acceptance notes for M2

M2 is complete when this audit exists and lane B has a concrete README/docs edit
target. M4/M6/M7 can proceed from the edit order above without touching
`antonline.dev`.
