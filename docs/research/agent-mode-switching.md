# Agent Mode Switching

Date: 2026-05-16
Author: @evolveantcodex
Status: Decision doc. No implementation claim.
Task: #84

## Purpose

JWPK direction: premium native clients should let the operator switch agents
between modes such as build, review, focus, research, exploring, and critic.
Mode affects prompt framing, allowed tools, model/provider policy, and audit.

Mode switching is not just a UI label. It is an operational contract:

- an agent in review mode should not quietly edit files.
- an agent in research mode should cite and verify sources.
- an agent in focus mode should be protected from interruptions.
- an agent in build mode can use write tools and deployment discipline.
- Chair can use lightweight local models for low-risk coordination while
  build/research work can route to stronger providers.

## Recommendation

Model agent mode as a server-authoritative state attached to a room member,
with per-task and per-message overrides. Native clients render and control the
mode as a premium UX surface; server and CLI enforce tool/prompt/model policy.

First implementation should be contract-first:

1. Add a compact mode status object.
2. Store mode changes with audit.
3. Emit mode metadata on messages and tasks.
4. Use mode to select prompt prefix, tool scope, and model policy.
5. Add premium native controls after web/CLI can render the state.

Do not make mode a purely client-side preference. If mode changes tool access
or how other agents interpret the work, it must be visible and auditable.

## Mode Status Contract

Native/client requirement from Swift:

```json
{
  "currentMode": "review",
  "availableModes": ["build", "review", "research", "focus", "explore", "critic"],
  "canSwitch": true,
  "modeReason": "Review the #96 terminal escape patch without editing files.",
  "toolScope": "read_only",
  "modelPolicy": {
    "preferredProvider": "cloud_default",
    "fallbackPolicy": "ask_before_cloud",
    "localAllowed": true,
    "requiresResearchVerification": false
  },
  "expiresAt": "2026-05-17T01:45:00.000Z",
  "audit": {
    "modeSetBy": "@jwpk",
    "modeSetAt": "2026-05-17T00:45:00.000Z",
    "auditLink": "/rooms/zj4jlety9q/modes/audit"
  }
}
```

Fields:

| Field | Meaning |
|---|---|
| `currentMode` | Active mode for this agent in this room/task. |
| `availableModes` | Modes the actor can switch to from this context. |
| `canSwitch` | Server-authoritative boolean for the current actor. |
| `modeReason` | Operator- or Chair-supplied reason. |
| `toolScope` | `read_only`, `write_limited`, `write_full`, `terminal_control`, or `none`. |
| `modelPolicy` | Provider and verification constraints for this mode. |
| `expiresAt` | Optional expiry for temporary modes; null means until changed. |
| `audit` | Who set the mode, when, and where to inspect history. |

Clients must not infer `canSwitch` or `toolScope`. They render the server
decision and disable controls when denied.

## Mode Taxonomy

### Build

Use when the agent is expected to modify code, tests, docs, or configuration.

| Setting | Value |
|---|---|
| `toolScope` | `write_full` or `write_limited` depending on lane boundaries. |
| Prompt prefix | "Implement the assigned change; verify before claim; respect deploy discipline." |
| Model policy | Strong coding model; local Chair only for coordination summaries. |
| Audit | Every message/task should record build mode. |

Rules:

- Must respect file ownership and deploy discipline.
- Can edit only inside assigned lane.
- Should commit or hand off with exact changed files.

### Review

Use when the agent should inspect and critique, not edit.

| Setting | Value |
|---|---|
| `toolScope` | `read_only`. |
| Prompt prefix | "Find bugs, regressions, missing tests, and contract drift; no edits." |
| Model policy | Local or cloud allowed; local model acceptable for first-pass triage. |
| Audit | Review findings carry mode marker. |

Rules:

- No file edits.
- No service restart.
- Findings first, with exact file/line refs where possible.

### Research

Use when the agent is collecting external/internal evidence.

| Setting | Value |
|---|---|
| `toolScope` | `read_only` plus approved web/docs/connectors. |
| Prompt prefix | "Use primary sources, cite evidence, separate facts from inference." |
| Model policy | #86 research thresholds apply. |
| Audit | Research sources, claims, and confirmations carry mode marker. |

Rules:

- No unsourced factual claims for current/technical/legal/financial matters.
- Store source, claim, and verification status.
- Chair may dedupe and refine research asks.

### Focus

Use when an agent is heads-down on a named target and should not be
interrupted.

This maps directly to #78b participant-targeted focus mode:

- room owner chooses agent(s).
- duration can be fixed or indefinite.
- active focus badge appears on participant rows.
- reason describes what the agent should focus on.

| Setting | Value |
|---|---|
| `toolScope` | Inherits base mode, usually `write_limited` or `read_only`. |
| Prompt prefix | "Stay on the focus target; do not pick unrelated work." |
| Model policy | Inherits base mode. |
| Audit | Focus entered/exited and mode expiry are recorded. |

Focus is best represented as a mode modifier over another mode:

- `build + focus`
- `research + focus`
- `review + focus`

### Explore

Use when the agent is discovering codebase shape or product options before
implementation.

| Setting | Value |
|---|---|
| `toolScope` | `read_only`. |
| Prompt prefix | "Map the surface and identify options; do not edit." |
| Model policy | Local model acceptable for summarisation; stronger model for synthesis. |
| Audit | Findings should become a plan, ask, or decision doc. |

Rules:

- Ends with a concrete plan, options, or blockers.
- Should not drift into implementation without a mode switch.

### Critic

Use when the agent is intentionally challenging a proposal, design, or shipped
slice.

| Setting | Value |
|---|---|
| `toolScope` | `read_only`. |
| Prompt prefix | "Stress-test assumptions; identify failure modes and weak evidence." |
| Model policy | Strong reasoning model; local model only for prep. |
| Audit | Critic comments should be clearly marked as critique. |

Rules:

- No implementation.
- Focus on risks, tradeoffs, and missing evidence.
- Must produce actionable alternatives, not vague negativity.

### Chair

Use for coordination rather than direct work.

| Setting | Value |
|---|---|
| `toolScope` | `coordination_only`; no direct file edits. |
| Prompt prefix | "Cluster asks, dedupe blockers, assign lanes, maintain the operator queue." |
| Model policy | #85 local model priority; cloud only with visible fallback. |
| Audit | Chair decisions and delegated choices are logged. |

Chair mode is a role plus mode. A human or agent can hand off Chair, but the
mode must remain visible because it changes what the agent is allowed to do.

## Prompt and Tool Policy

Represent mode policy as data:

```ts
type AgentModePolicy = {
  mode: AgentMode;
  promptPrefix: string;
  toolScope: 'none' | 'read_only' | 'write_limited' | 'write_full' | 'terminal_control' | 'coordination_only';
  allowedToolGroups: string[];
  deniedToolGroups: string[];
  requiresConfirmationFor: string[];
  modelPolicy: AgentModeModelPolicy;
};
```

Suggested tool groups:

| Tool group | Examples |
|---|---|
| `read_files` | `rg`, `sed`, `git show`, docs fetch. |
| `write_files` | `apply_patch`, formatting, generated docs. |
| `run_tests` | `bun test`, `bun run check`, focused test commands. |
| `service_touch` | build, restart, launchctl, deploy. |
| `terminal_control` | terminal escape/interrupt, PTY inject. |
| `web_research` | browser/search with source citations. |
| `coordination` | asks, plans, room updates, task assignment. |
| `connectors` | Drive, Gmail, GitHub, etc., permission-gated. |

Mode examples:

| Mode | Allowed | Denied by default |
|---|---|---|
| Build | read files, write files, run tests | service touch unless deploy lane open |
| Review | read files, run non-mutating checks | write files, service touch |
| Research | web research, read docs, coordination | write files, service touch |
| Focus | inherited | unrelated tasks |
| Explore | read files, coordination | write files |
| Critic | read files, coordination | write files, service touch |
| Chair | coordination, asks, plan/task updates | arbitrary code edits |

## Model Selection

Mode should influence model/provider policy, not hard-code a single model:

```ts
type AgentModeModelPolicy = {
  preferredClass: 'local_small' | 'local_large' | 'cloud_coding' | 'cloud_reasoning' | 'cloud_research';
  allowLocal: boolean;
  allowCloud: boolean;
  fallbackPolicy: 'never' | 'ask_before_cloud' | 'local_then_cloud' | 'cloud_allowed';
  researchPolicy?: 'off' | 'solo' | 'team' | 'enterprise' | 'custom';
};
```

Suggested defaults:

| Mode | Preferred class | Notes |
|---|---|---|
| Build | `cloud_coding` | Needs strong code generation and tool planning. |
| Review | `cloud_reasoning` or `local_large` | Read-only review can use local first for low-risk passes. |
| Research | `cloud_research` | Must honor #86 verification thresholds. |
| Focus | inherited | Focus modifies attention, not model by itself. |
| Explore | `cloud_reasoning` or `local_large` | Local okay for map/summarize; cloud for synthesis. |
| Critic | `cloud_reasoning` | Needs strong adversarial reasoning. |
| Chair | `local_small` first | #85 AFM/Ollama/llama.cpp priority; cloud fallback visible. |

## Persistence Levels

Modes need three levels:

1. Agent default mode.
2. Per-room mode.
3. Per-task or per-message override.

Precedence:

1. Explicit per-task/per-message override.
2. Active per-room agent mode.
3. Agent default mode.
4. System default: `build` for assigned implementation lanes, `review` for
   explicit review lanes, `explore` for unassigned discovery.

Temporary modes use `expiresAt`:

- focus for 15/30/60/custom minutes or indefinite.
- critic for one review pass.
- research for one research session.
- build until task complete or mode changed.

## Audit

Every mode switch creates an audit row:

```ts
type AgentModeAuditRow = {
  id: string;
  roomId: string;
  memberHandle: string;
  fromMode: AgentMode | null;
  toMode: AgentMode;
  reason?: string;
  setBy: string;
  setAtMs: number;
  expiresAtMs?: number | null;
  scope: 'agent_default' | 'room' | 'task' | 'message';
};
```

Every generated message/task should carry the effective mode:

```json
{
  "messageId": "msg_123",
  "authorHandle": "@evolveantcodex",
  "effectiveMode": "research",
  "toolScope": "read_only",
  "modeAuditId": "mode_audit_456"
}
```

This answers: "what mode was this message sent in?" and "why did this agent
have write tools?"

## Mode Switch UX

### Premium Native

Native apps should make mode switching feel first-class:

- participant row mode chip.
- quick mode dropdown.
- "Focus until..." duration picker.
- mode reason field.
- model/privacy badge when mode changes provider policy.
- disabled modes with reason: "Review mode unavailable: you are not room
  owner" or "Build mode denied: lane is read-only."

### Web/OSS

Web should render the state and basic controls where the server allows it:

- participant chip shows current mode.
- room More can show "Agent modes".
- mode audit visible in details.
- no premium local-model/provider controls.

### CLI

CLI should support:

```sh
ant chat mode set <roomId> @agent --mode review --reason "QA gate" --duration 30m
ant chat mode clear <roomId> @agent
ant chat mode list <roomId>
```

This gives agents and operators a scriptable path before native UI is complete.

## Permissions

Server decides who can switch:

| Actor | Can switch |
|---|---|
| Room owner/admin | Any member mode in that room. |
| Chair | Assign safe modes within delegated policy. |
| Agent itself | Can request mode, cannot grant itself broader tool scope. |
| Regular participant | Can switch own display-only mode if it does not alter tools. |

Dangerous transitions require confirmation:

- `review -> build`
- any mode -> `terminal_control`
- local-only provider -> cloud-allowed policy
- `focus` clear for another agent

## Integration With Existing Features

### #78 Focus Mode

Focus becomes a mode modifier attached to a participant. The existing
`focusModeStore` already provides per-room/per-member reason and expiry.
Mode switching should reuse that shape rather than create a second focus
state.

### #86 Research Mode

Research mode selects a verification policy. A research-mode message or task
must include the active verification threshold and badge link.

### #85 Chair Local Models

Chair mode uses #85 provider capability objects. If Chair runs locally, the
mode status should show on-device/local/cloud fallback state.

### #89 Idle Suggestions

Idle suggestions should consider mode:

- do not suggest build tasks to a review-mode agent.
- do not interrupt focus mode unless focus is stale.
- suggest inspect/critic actions to critic-mode agents.

### #92 Permissions

Mode does not replace permission checks. It narrows or frames allowed behavior;
the server still checks capabilities for documents, rooms, tools, and remote
agent actions.

## Implementation Slices

### S1: Contract and Read Model

- Add `AgentMode`, `AgentModeStatus`, and `AgentModePolicy` types.
- Add read endpoint returning mode status for room members.
- Render mode chip read-only on participant rows.

### S2: Mode Audit Store

- Add mode change audit storage.
- Support per-room member mode and expiry.
- Attach effective mode to messages/tasks.

### S3: Mode Switching Controls

- Add server route and CLI command to set/clear/list modes.
- Add native/web controls gated by `canSwitch`.
- Reuse focus duration picker for focus-mode modifier.

### S4: Tool Scope Enforcement

- Map mode policy to tool groups.
- Enforce read-only review/research/explore modes.
- Require confirmation for dangerous transitions.

### S5: Model Policy Routing

- Connect modes to #85 model provider policy.
- Connect research mode to #86 verification thresholds.
- Store model/fallback metadata in mode audit.

### S6: Premium Native Polish

- Native mode dropdown and participant chips.
- Mode reason templates.
- Local/cloud privacy badge.
- Mode history panel.

## Open Decisions

1. Whether `focus` should be represented as a standalone mode in the UI or
   always as a modifier over another mode.
2. Whether agents may request build mode themselves, or must wait for Chair or
   operator approval.
3. Which mode should be the default for a newly invited agent with no assigned
   task: `explore`, `review`, or `build`.
4. Whether mode policy should live in room settings or a global org policy for
   enterprise.

## Sources Checked

- Existing focus contract:
  `src/lib/server/focusModeStore.ts`
- Existing plan mode/event vocabulary:
  `src/lib/server/planModeStore.ts`
- Chair local-model design:
  `docs/research/chair-local-models.md`
- Research mode design:
  `docs/research/research-mode.md`
- Idle suggestions design:
  `docs/research/idle-agent-suggestion.md`
- Agent permissions design:
  `docs/research/agent-permissions.md`
