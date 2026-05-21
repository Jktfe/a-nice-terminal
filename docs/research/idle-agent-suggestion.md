# Dependency-Aware Idle Agent Suggestions

Date: 2026-05-16
Author: @evolveantcodex
Status: Decision doc. No implementation claim.
Task: #89

## Purpose

When an agent is stuck or idle, ANT should help it move without asking the
operator for another instruction. The system should suggest one of two useful
next moves:

1. Pick a task whose dependency blockers are already cleared.
2. Inspect another working agent's terminal, then agree with the current work
   or offer a concrete alternative.

This builds on the existing v4 contracts:

- Agent attention state: `agentStatusStore` has
  `idle | thinking | working | response-required`.
- Plans/tasks: `tasks` rows have `blockedBy`, `blocks`, `priority`,
  `assignedAgent`, `assigned_to`, `assigned_terminal_id`, and `room_id`.
- Editable Gantt: dependencies and priorities are already editable in web.
- Focus mode: room owners can put specific participants into focus.
- Terminal inspection: `terminal_run_events` is an append-only, sanitized
  read model for terminal activity.

The design should be contract-first and UI-light. Native clients can later
render the same suggestion objects as cards, notifications, or Chair prompts.

## Recommendation

Ship a small server-side suggestion feed first:

`GET /api/chat-rooms/:roomId/idle-suggestions?handle=@agent`

The response returns ranked suggestion objects. It does not mutate tasks,
focus state, or terminal state. The first UI pass only displays suggestions
next to idle participants and gives each suggestion one explicit action.

This keeps the feature explainable, testable, and safe. The Chair can later
use the same feed to proactively nudge agents, but the first version should
avoid autonomous reassignment.

## Idle Detection

Idle should be derived, not guessed from a single signal.

Primary signals:

| Signal | Source | Meaning |
|---|---|---|
| `agent_status = idle` | `agentStatusStore` / `terminals` | Agent is available. |
| stale `agent_status_at_ms` | `terminals` | Agent has not changed state recently. |
| no recent high/medium terminal events | `terminal_run_events` | No meaningful output in the recent window. |
| task assigned but unchanged | `tasks.updated_at_ms` | Agent may be stuck on assigned work. |
| focus mode active | `focusModeStore` | Agent should not be interrupted unless focus target is stale or complete. |

Recommended v1 thresholds:

- `idle`: status is `idle` for at least 2 minutes.
- `possibly_stuck`: status is `working` or `thinking`, but no high/medium
  event for at least 10 minutes and the assigned task has not changed.
- `response_required`: status is `response-required`; do not auto-suggest a
  new task. Surface the response-required state instead.

The suggestion feed should include the detected reason so UI and agents can
explain the nudge:

```json
{
  "agentHandle": "@evolveantcodex",
  "state": "idle",
  "reason": "idle_for_2m",
  "observedAtMs": 1778969000000
}
```

## Suggestion Types

### 1. Dependency-Cleared Task Suggestion

Query candidate tasks in the same room:

- `status IN ('pending', 'blocked')`, excluding `deleted` and `completed`.
- `room_id = :roomId` OR task belongs to a plan attached to the room through
  `plan_rooms`.
- every task id in `blockedBy` resolves to `status = completed`, or the
  `blockedBy` array is empty.
- prefer matching `assigned_to`, `assignedAgent`, `assigned_terminal_id`, or
  agent kind affinity when present.
- sort by `priority IS NULL`, `priority ASC`, then age.

Suggested object:

```json
{
  "id": "suggestion_task_t123",
  "type": "dependency_cleared_task",
  "rank": 1,
  "title": "Pick unblocked task: #96 terminal escape follow-up",
  "body": "No dependency blockers remain. Priority 1. Assigned to @evolveantcodex.",
  "taskId": "t123",
  "planId": "v4-fresh-ant",
  "actions": [
    { "kind": "open_task", "label": "Open task" },
    { "kind": "claim_task", "label": "Claim / start" }
  ]
}
```

V1 action behavior:

- `open_task`: navigates to the task detail/Gantt context.
- `claim_task`: patches assignment/status only after explicit user or agent
  confirmation. The suggestion endpoint itself never claims.

### 2. Inspect Working Agent Suggestion

When no suitable task exists, or when a closely related task is actively being
worked by another agent, suggest inspection instead of duplicate work.

Candidate terminals:

- same room membership or linked terminal context.
- `agent_status IN ('working', 'thinking')`.
- has recent `terminal_run_events`.
- not the same terminal as the idle agent.
- not in private/native-only context unless permissions allow inspection.

Inspection source:

- Use `terminal_run_events` as the read-only evidence stream.
- Do not mirror raw terminal bytes into chat for this feature.
- Prefer high/medium trust events; include raw only behind an explicit
  "show raw" affordance in terminal UI.

Suggested object:

```json
{
  "id": "suggestion_inspect_t456",
  "type": "inspect_working_agent",
  "rank": 2,
  "title": "Inspect @evolvemantsvelte on editable Gantt",
  "body": "Svelte is active on a related plan task. Review the latest terminal events before starting parallel work.",
  "terminalId": "t456",
  "agentHandle": "@evolvemantsvelte",
  "actions": [
    { "kind": "inspect_terminal", "label": "Inspect terminal" },
    { "kind": "agree", "label": "Looks right" },
    { "kind": "offer_alternative", "label": "Offer alternative" }
  ]
}
```

V1 action behavior:

- `inspect_terminal`: opens the terminal view in read-only inspection mode.
- `agree`: posts a lightweight room event or reaction stating the inspecting
  participant agrees with the current approach.
- `offer_alternative`: opens a composer prefilled with context and a prompt
  to write the alternative. It should route to the working agent if the user
  leaves the bare `@handle`, or remain informational if bracketed.

## Ranking

Ranking should be deterministic and boring:

1. Unblocked tasks explicitly assigned to the idle agent.
2. Unblocked tasks assigned to the same terminal.
3. Unblocked tasks in the same room with the lowest priority number.
4. Inspect working agents assigned to related tasks in the same plan.
5. Inspect any working agent in the same room.

Tie-breakers:

- older pending tasks before newer tasks.
- higher-confidence idle state before softer "possibly stuck" state.
- do not suggest tasks blocked by focus mode unless the focus target matches.

## UI Surfaces

### Web v1

Keep it small:

- Participant row/card shows a subtle "Suggested next move" line only when
  the participant is idle or possibly stuck.
- Clicking it opens a compact suggestion popover with one to three cards.
- Cards have explicit actions; no background mutation.
- Room More can include "Idle suggestions" later, but it is not needed for v1.

### Terminal Inspection

Read-only mode should make the safety boundary obvious:

- Header: `Inspecting @agent`.
- Source: latest `terminal_run_events`, not direct PTY control.
- Default filter: high/medium trust events and recent raw summaries.
- CTA row: `Looks right`, `Offer alternative`, `Open linked chat`.

Do not expose the 🛑 terminal interrupt from inspection mode unless the
operator has terminal-control permission. Inspecting work and stopping work
are separate powers.

### Native Clients

Native clients should consume the same suggestion feed:

- iOS: participant-row cards or local notification when an agent is idle.
- Tauri/Mac: sidebar participant badges and suggestion cards.
- Premium Chair: clustered suggestion queue, dedupe, and proactive routing.

## Permissions

V1 should be conservative:

| Action | Permission |
|---|---|
| View own suggestions | room member |
| View all participant suggestions | room admin/chair/operator |
| Inspect terminal events | room member if terminal is linked to the room; otherwise admin/chair |
| Claim task | assignee, room admin/chair, or explicit user action |
| Agree | room member |
| Offer alternative | room member |
| Interrupt terminal | out of scope; governed by #96 terminal escape permissions |

The suggestion feed should include only actions the caller can perform.

## API Shape

Recommended route:

`GET /api/chat-rooms/:roomId/idle-suggestions?handle=@agent`

Response:

```json
{
  "roomId": "zj4jlety9q",
  "targetHandle": "@evolveantcodex",
  "detectedState": {
    "state": "idle",
    "reason": "idle_for_2m",
    "terminalId": "t_codex"
  },
  "suggestions": [
    {
      "id": "suggestion_task_t123",
      "type": "dependency_cleared_task",
      "rank": 1,
      "title": "Pick unblocked task",
      "body": "No dependency blockers remain.",
      "taskId": "t123",
      "actions": [{ "kind": "open_task", "label": "Open task" }]
    }
  ]
}
```

Optional follow-up routes:

- `POST /api/chat-rooms/:roomId/idle-suggestions/:id/ack`
- `POST /api/chat-rooms/:roomId/idle-suggestions/:id/offer-alternative`

These should be deferred until the read-only feed proves useful. Existing
task PATCH, chat message, reaction, and terminal routes can handle most v1
actions.

## Implementation Slices

### S1 — Read-Only Suggestion Engine

- Add a server helper that derives idle/stuck state from agent status,
  terminal events, focus state, and assigned task freshness.
- Add a task candidate query for dependency-cleared tasks.
- Add a working-agent candidate query using agent status + recent run events.
- Add route tests with seeded tasks, dependencies, statuses, and events.

### S2 — Participant UI

- Show suggestion affordance on idle participant rows/cards.
- Popover renders ranked cards from the route.
- `open_task` and `inspect_terminal` are navigation-only.
- No autonomous claiming in this slice.

### S3 — Agree / Offer Alternative

- `agree` posts reaction or room event.
- `offer_alternative` opens a prefilled composer with context.
- Preserve routing semantics: bare `@handle` routes; `[@handle]` is
  informational.

### S4 — Chair / Native Premium Layer

- Chair clusters repeated idle suggestions.
- Native clients can show proactive notifications.
- Chair can apply policy: "idle agents pick unblocked tasks first; inspect
  before duplicating active work."

## Risks

1. **Annoying nudges.** If thresholds are too aggressive, agents will churn.
   Start with read-only suggestions and visible reasons.
2. **Duplicate work.** If task assignment is stale, suggestions can still
   collide. Prefer inspection suggestions when a related task has an active
   working agent.
3. **Permission leaks.** Terminal inspection must respect room linkage and
   future remote-work permissions.
4. **False idle.** Some useful work is quiet. Use status + event freshness +
   task freshness, not message gaps alone.
5. **Focus conflict.** Focused agents should not be nudged away from the focus
   target unless the target is complete or stale.

## Acceptance Criteria

- Idle suggestions are explainable: every suggestion has a reason and source.
- Dependency-cleared task suggestions never include a task with incomplete
  blockers.
- Inspect suggestions never expose terminal events outside the caller's room
  permission scope.
- The first implementation is read-only until a user or agent explicitly
  chooses an action.
- Native clients can use the same response shape without needing web-only
  assumptions.

## Open Questions

1. Should `claim_task` be allowed for agents without user confirmation, or
   should it always require an explicit click/command?
2. Should inspection default to high/medium events only, or show raw events
   behind a toggle from the first release?
3. Should the Chair be allowed to proactively route an idle agent to a task,
   or only present suggestions for now?

Recommendation: defer all three. Ship the read-only feed and participant UI
first, then let JWPK tune autonomy once the suggestions are visible.
