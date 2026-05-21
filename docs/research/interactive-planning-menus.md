# Interactive Planning Menus

Date: 2026-05-16
Author: @evolveantcodex
Status: Decision doc. No implementation claim.
Task: #83

## Purpose

JWPK direction: premium native clients need interactive menus for planning.
The goal is to make planning feel like a real operational workspace, not a set
of hidden endpoints or static Gantt rows.

Interactive planning menus should let a user quickly:

- create tasks and plans.
- assign or reassign agents.
- change priorities.
- add or remove dependencies.
- batch-edit selected tasks.
- ask Chair for the next useful action.
- inspect dependency blockers and idle-agent suggestions.
- undo recent planning actions where safe.

This builds on shipped/shared work:

- #54 read-only plans/tasks in room info.
- #79 editable Gantt priorities and dependencies.
- #89 dependency-aware idle agent suggestions.
- #84 agent mode switching.
- #92 permissions/capability decisions.

## Recommendation

Implement interactive planning menus as a shared server-approved action model
with multiple premium native renderers:

- command palette on desktop.
- contextual menus on task/Gantt rows.
- touch sheets on iOS/iPad.
- slash command assist in chat/composer.

The important architectural choice: all renderers execute the same
server-approved planning actions. Native clients may look richer, but they
must not invent planning mutations locally.

## Planning Action Contract

Native/client requirement from Swift:

```json
{
  "actionId": "task.reprioritize",
  "label": "Set priority to 1",
  "scope": "task",
  "requiredCapability": "canEditTask",
  "preview": {
    "title": "3 tasks will move to priority 1",
    "diff": [
      { "taskId": "t1", "field": "priority", "from": 3, "to": 1 },
      { "taskId": "t2", "field": "priority", "from": null, "to": 1 }
    ]
  },
  "affectedTasks": ["t1", "t2", "t3"],
  "undoToken": "undo_abc123",
  "keyboardShortcut": "⌘⇧1",
  "audit": {
    "auditMarker": "plan_action_456",
    "requiresConfirmation": false
  }
}
```

Fields:

| Field | Meaning |
|---|---|
| `actionId` | Stable action id, e.g. `task.assign`, `task.addDependency`. |
| `label` | Human label for menu/palette/touch sheet. |
| `scope` | `global`, `room`, `plan`, `task`, `selection`, or `agent`. |
| `requiredCapability` | Server capability needed to execute. |
| `preview` | Server-generated effect preview before mutation. |
| `affectedTasks` | Task ids affected by the action. |
| `undoToken` | Optional token for safe rollback. |
| `keyboardShortcut` | Optional client shortcut hint. |
| `audit` | Audit marker and confirmation requirements. |

Clients render this object. Servers decide availability and execution.

## Surfaces

### Global Command Palette

Desktop premium should expose `Cmd+K` / `Ctrl+K`.

Recommended sections:

- Create: new plan, new task, new milestone.
- Navigate: open plan, open room tasks, open blocker.
- Assign: assign selected task to agent.
- Prioritize: set priority, bump up/down, clear priority.
- Dependencies: add blocker, remove blocker, show dependency chain.
- Modes: put agent into focus/research/review/build.
- Chair: ask Chair for next action, dedupe asks, suggest unblocked work.

The command palette is best for keyboard-heavy operators.

### Contextual Task Menus

Task row/card/Gantt bar menu:

- Open detail.
- Edit priority.
- Assign to agent.
- Mark blocked/in progress/done.
- Add dependency.
- Remove dependency.
- Create follow-up task.
- Ask Chair why blocked.
- Inspect assigned agent terminal.

Context menus should be concise and state-aware. Do not show actions the
server denies unless the UI can explain why they are disabled.

### Touch Sheets

iOS/iPad premium should use touch sheets:

- long-press task -> planning sheet.
- multi-select tasks -> batch action sheet.
- participant row -> assign/focus/mode actions.
- dependency chip -> inspect chain or remove blocker.

Touch sheets use the same action contract but prioritize tap targets and short
labels.

### Slash Command Assist

Slash commands are useful inside chat but should not be the primary premium
planning UX. They are a bridge for power users and agents.

Examples:

```text
/task create "Fix read receipts" priority:1 assign:@evolveantcodex
/task block #84 by #92
/plan assign #55 @evolveantkimi
/chair next
```

The slash layer should resolve to the same action preview and confirmation
model as the menu layer.

## Core Actions

### Task Creation

Action id: `task.create`

Inputs:

- subject.
- optional description.
- optional plan id.
- optional room id for standalone room-scoped tasks.
- optional priority.
- optional assigned agent.
- optional blockers.

Preview:

- where the task will appear.
- whether it is blocked.
- who will be assigned.

### Assignment

Action id: `task.assign`

Inputs:

- task ids.
- agent handle.
- optional mode after assignment: build/review/research/focus.

Validation:

- agent is in room or can be invited.
- actor can edit task.
- mode switch is allowed by #84 policy.

### Priority Edit

Action id: `task.reprioritize`

Inputs:

- task ids.
- priority number or clear.

Validation:

- actor can edit all selected tasks.
- batch operation is atomic where possible.

### Dependency Add/Remove

Action ids:

- `task.addDependency`
- `task.removeDependency`

Inputs:

- task id.
- blocker task id.

Validation:

- no self-edge.
- no missing task.
- no cycle.
- actor can edit dependency graph.

The current `taskStore` already mirrors `blockedBy` and `blocks` in one
transaction. Interactive menus should preserve that invariant.

### Batch Operations

Batch actions:

- assign selected tasks.
- set status.
- set priority.
- add common blocker.
- move tasks into a plan.
- archive completed tasks from the view.

Batch preview must list affected tasks and failures separately:

```json
{
  "willChange": ["t1", "t2"],
  "willSkip": [
    { "taskId": "t3", "reason": "Permission denied" },
    { "taskId": "t4", "reason": "Would create dependency cycle" }
  ]
}
```

## Chair-Assisted Planning

Chair should turn planning menus from static commands into guided choices.

Chair suggestions:

- "Pick an unblocked task."
- "Assign this to @evolveantcodex; similar work is already in its lane."
- "This dependency is stale; blocker is completed."
- "This task belongs in #55 CLI rather than #83 planning."
- "Inspect @evolvemantsvelte before duplicating this UI work."

Sources:

- #89 idle suggestion feed.
- task priority/dependency graph.
- focus mode state.
- agent modes from #84.
- terminal inspection summaries.
- asks queue.

Chair suggestions should still resolve to normal planning actions with preview
and audit.

## Capability and Permission Model

Action availability should be server-authored:

```json
{
  "actionId": "task.assign",
  "available": true,
  "requiredCapability": "canEditTask",
  "deniedReason": null
}
```

Recommended capabilities:

| Capability | Meaning |
|---|---|
| `canCreateTask` | Create task in selected room/plan. |
| `canEditTask` | Patch subject/status/priority/assignment. |
| `canEditDependencies` | Add/remove task dependency edges. |
| `canAssignAgent` | Assign task to agent or terminal. |
| `canSwitchAgentMode` | Change agent mode per #84. |
| `canBatchEdit` | Apply changes to multiple tasks. |
| `canUndoPlanningAction` | Use an undo token. |
| `canAskChair` | Ask Chair to suggest/refine actions. |

This should reuse the #92 pattern: server returns booleans/capabilities;
clients render them.

## Undo and Audit

Every planning mutation should create an audit row:

```ts
type PlanningActionAudit = {
  id: string;
  actionId: string;
  actorHandle: string;
  roomId?: string;
  planId?: string;
  affectedTasks: string[];
  beforeJson: string;
  afterJson: string;
  createdAtMs: number;
  undoToken?: string;
  undoExpiresAtMs?: number;
};
```

Undo rules:

- only offer undo for reversible mutations.
- short undo window, e.g. 2 minutes for priority/assignment/status.
- no undo after a dependent mutation uses the new state.
- no undo for actions that triggered external effects unless those effects are
  also reversible.

Audit must survive even when undo is used.

## Keyboard Navigation

Desktop command palette:

- `Cmd+K`: open palette.
- type to filter.
- arrows to move.
- Enter to preview/execute.
- `Cmd+Enter`: execute safe action directly.
- Escape: close.
- `Cmd+Z`: undo last reversible planning action.

Gantt:

- arrow keys move task focus.
- Enter opens detail.
- `P` opens priority action.
- `A` opens assignment action.
- `D` opens dependency action.
- Space toggles multi-select.

Keyboard shortcuts are hints from the server contract, but clients may adapt
where platform conventions differ.

## Integration With Existing UI

### `/plans/:id` Gantt

Existing shipped behavior:

- task rows and bars.
- client filters by priority and agent.
- task detail panel.
- inline priority edit.
- dependency add/remove picker.

Premium menus should enhance this view:

- row context menu.
- multi-select.
- command palette scoped to current plan.
- batch edit.
- dependency chain viewer.
- Chair suggestions in side panel.

Do not remove the current direct edit controls; keep them as the simple web
baseline.

### Room More Menu

Room More should expose:

- Tasks.
- Plans.
- Focus.
- Agent modes.
- Chair suggestions.

Premium native can make this richer, but web should keep a readable shared
surface.

### Idle Suggestions

The #89 suggestion feed becomes an input to planning menus:

- suggestion card -> action preview.
- "Claim task" -> task assignment/status action.
- "Inspect terminal" -> terminal read-only inspection.
- "Offer alternative" -> prefilled message/action pair.

## Native Client Contract

Native clients need one endpoint shape:

```json
{
  "context": {
    "roomId": "zj4jlety9q",
    "planId": "v4-fresh-ant",
    "selection": ["t1", "t2"]
  },
  "actions": [
    {
      "actionId": "task.assign",
      "label": "Assign to @evolveantcodex",
      "scope": "selection",
      "requiredCapability": "canAssignAgent",
      "preview": {
        "title": "Assign 2 tasks to @evolveantcodex",
        "diff": []
      },
      "affectedTasks": ["t1", "t2"],
      "undoToken": null,
      "keyboardShortcut": "A",
      "audit": {
        "auditMarker": null,
        "requiresConfirmation": true
      }
    }
  ]
}
```

Clients can render the same action list as:

- command palette rows.
- context menu items.
- toolbar buttons.
- touch sheet rows.
- agent suggestion cards.

Execution should be a separate POST:

```json
{
  "actionId": "task.assign",
  "context": {
    "roomId": "zj4jlety9q",
    "planId": "v4-fresh-ant",
    "selection": ["t1", "t2"]
  },
  "input": {
    "assignedAgent": "@evolveantcodex"
  },
  "confirmedPreviewHash": "preview_hash_123"
}
```

The `confirmedPreviewHash` prevents stale previews from mutating after the
task graph changes.

## Premium Gate

OSS/web:

- keeps current direct controls.
- can render server-approved action lists where available.
- no advanced command palette, Chair-assisted menus, or cross-surface batch
  planning unless explicitly enabled.

Premium native:

- command palette.
- contextual/touch planning sheets.
- batch operations.
- Chair-assisted next-action menus.
- offline/local planning cache where safe.

Enterprise:

- org-level action policy.
- role-based planning permissions.
- audit export.
- approval flows for destructive/batch actions.

## Implementation Slices

### S1: Action Registry

- Add `PlanningAction` and `PlanningActionPreview` types.
- Add read endpoint for available actions in a context.
- Return disabled actions with denied reasons.

### S2: Preview and Execute

- Add preview endpoint.
- Add execute endpoint requiring `confirmedPreviewHash`.
- Implement priority, assignment, and dependency actions first.

### S3: Audit and Undo

- Add planning action audit rows.
- Add undo tokens for reversible actions.
- Add undo endpoint.

### S4: Web Baseline

- Add row context menu on `/plans/:id`.
- Add command palette shell scoped to current plan.
- Keep direct Gantt controls.

### S5: Chair Suggestions

- Connect #89 idle suggestions to planning actions.
- Add Chair "next action" menu section.
- Add suggest/preview/execute loop.

### S6: Premium Native

- Tauri/Mac command palette.
- iOS touch sheets.
- Keyboard shortcuts.
- Batch multi-select operations.

## Open Decisions

1. Whether `Cmd+K` should be premium-only or whether web/OSS gets a basic
   discoverability palette.
2. Whether batch operations are allowed before #92 permissions are fully
   implemented, or whether V1 batch must be room-owner-only.
3. Whether undo tokens should be stored in the same audit table or a separate
   short-lived undo table.
4. Whether Chair suggestions can auto-execute safe actions, or must always
   require preview confirmation.

## Sources Checked

- Existing Gantt/detail UI:
  `src/routes/plans/[planId]/+page.svelte`
- Existing task model and dependency invariants:
  `src/lib/server/taskStore.ts`
- Existing task PATCH/dependency routes:
  `src/routes/api/tasks/[taskId]/+server.ts`,
  `src/routes/api/tasks/[taskId]/dependencies/+server.ts`
- Agent mode switching design:
  `docs/research/agent-mode-switching.md`
- Idle suggestion design:
  `docs/research/idle-agent-suggestion.md`
- Agent permissions design:
  `docs/research/agent-permissions.md`
