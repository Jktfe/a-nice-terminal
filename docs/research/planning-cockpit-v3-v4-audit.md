# #136 Planning Cockpit v3-v4 Audit

Date: 2026-05-17 14:30 BST  
Owner: @evolveantcodex  
Mode: read-only server/data contract audit

## Decision

Restore the v3 planning cockpit as the primary plan view. Keep Gantt as an
alternate view for priority, dependency and idle-agent sequencing. The v4
data exists in pieces, but the product currently makes the Gantt/task render
the main route and leaves the v3-style phase/task/milestone cockpit split
across secondary pages.

## What v3 Did Well

Primary surface: `a-nice-terminal/src/routes/plan/+page.svelte` rendering
`a-nice-terminal/src/lib/components/PlanView/PlanView.svelte`.

Data source:

- `GET /api/plans` listed plan refs from live `plan_*` run events.
- `GET /api/plan?session_id=...&plan_id=...` returned validated plan events.
- `POST /api/plan/events` and `PATCH /api/plan/events/:id` supported inline
  cockpit edits.
- WebSocket `run_event_created` pushed live `plan_*` updates into the page.

Cockpit behavior:

- Plans were grouped into sections/phases.
- Milestones rendered under sections, with status, owner, acceptance,
  tests, evidence links and linked tasks.
- Progress was visible in three levels: overall plan progress, section
  progress and milestone test progress.
- Sidebar rail showed live milestone, queued count, recent done count and
  owners.
- Inline editing supported rename, mark done, add section, add milestone,
  add decision and archive/unarchive.
- Evidence/provenance degraded visibly instead of disappearing.

Key v3 implementation references:

- `src/lib/components/PlanView/PlanView.svelte`
- `src/lib/components/PlanView/ProgressRing.svelte`
- `src/lib/components/PlanView/ProgressBar.svelte`
- `src/lib/components/PlanView/types.ts`
- `src/lib/server/projector/plan-view.ts`
- `src/routes/api/plan/+server.ts`
- `src/routes/api/plans/+server.ts`
- `tests/plan-view-render.test.ts`
- `tests/plan-live-api.test.ts`

## What v4 Has Now

v4 has the ingredients, but not the cockpit.

### `/plans`

Files:

- `src/routes/plans/+page.svelte`
- `src/routes/plans/+page.ts`
- `src/routes/api/plans/completions/+server.ts`
- `src/lib/components/PlanDonutCard.svelte`

Status:

- Shows plan donut cards from persisted task completion.
- Supports active, archived and deleted plan filters.
- Does not show phases, milestones, inline evidence, task comments or live
  agent evidence.
- Copy explicitly says opening a plan goes to the Gantt.

Live evidence:

- `GET /api/plans/completions?active=1` returns active plan completion rows.
- Current live response includes `v4-fresh-ant` with `0/4` complete.

### `/plans/[planId]`

Files:

- `src/routes/plans/[planId]/+page.svelte`
- `src/routes/plans/[planId]/+page.ts`
- `src/routes/api/plans/[planId]/tasks/+server.ts`
- `src/lib/components/TaskDetailPanel.svelte`
- `src/lib/components/PlanRetrospective.svelte`

Status:

- Primary per-plan view is Gantt.
- Toggle has only `Gantt` and `Retrospective`.
- Task detail panel and dependency UI exist.
- This satisfies the additive Gantt ask, but it replaced the cockpit as the
  main plan-detail experience.

### `/plan-mode/[planId]`

Files:

- `src/routes/plan-mode/[planId]/+page.svelte`
- `src/lib/components/PlanRoster.svelte`
- `src/lib/server/planModeStore.ts`

Status:

- Still renders section, milestone, decision, acceptance and test events.
- Much simpler than v3 `PlanView`.
- In-memory only via `planModeStore`; not the primary plan route.
- No overall/section/test progress bars, no donut/rail experience, no linked
  task/evidence richness, no live stream in the page.

### `/plans/evidence`

Files:

- `src/routes/plans/evidence/+page.svelte`
- `src/routes/api/plans/evidence/+server.ts`
- `src/lib/server/planEvidenceStore.ts`

Status:

- Good cross-plan evidence search surface.
- Evidence is task-attached only.
- Current live `GET /api/plans/evidence?limit=5` returns zero evidence rows,
  which explains why the cockpit does not feel evidence-rich yet.

### `/plans/insights`

Files:

- `src/routes/plans/insights/+page.svelte`
- `src/lib/server/planInsightsStore.ts`

Status:

- Good analytics surface.
- Current live `/api/plans/insights` reports 11 plans, 13 tasks, 8 active
  plans and no evidence/duration data.
- This is useful supporting telemetry, not a replacement for the cockpit.

## Data Model Gap

v4 currently has two plan models:

1. Event-projected plan mode:
   - `planModeStore`
   - `PlanEvent`
   - sections, milestones, decisions, acceptance, tests, evidence,
     provenance
   - currently in-memory

2. Persisted plan/task model:
   - `plans`
   - `tasks`
   - `plan_rooms`
   - task evidence, dependencies, assignment, priority, timestamps
   - SQLite-backed

The cockpit needs both. The v3 cockpit was event-first. The v4 Gantt is
task-first. The restored primary view should be a merged projection:

```ts
type PlanCockpit = {
  plan: {
    id: string;
    title: string | null;
    description: string | null;
    lifecycle: 'active' | 'archived' | 'deleted';
  };
  progress: {
    tasks: { total: number; completed: number; pct: number };
    phases: Array<{ id: string; title: string; total: number; completed: number; pct: number }>;
    milestones: { total: number; completed: number; pct: number };
  };
  phases: Array<{
    id: string;
    title: string;
    body?: string;
    status?: string;
    milestones: Array<{
      id: string;
      title: string;
      status: string;
      owner?: string;
      acceptance?: string;
      tests: Array<{ id: string; title: string; status: string; evidence: EvidenceRef[] }>;
      tasks: Task[];
      evidence: EvidenceRef[];
      comments: PlanActivity[];
    }>;
    decisions: PlanDecision[];
  }>;
  unphasedTasks: Task[];
  rooms: Array<{ roomId: string; name: string }>;
  recentActivity: PlanActivity[];
};
```

## Minimum Server/Data Contract

Add a read endpoint:

- `GET /api/plans/:planId/cockpit`

It should merge:

- `getPlan(planId)`
- `planCompletion(planId)`
- `listTasksForPlan(planId)`
- `projectPlanEvents(planId)` or persisted plan events if #136 expands into
  event persistence
- `listAllEvidence({ planId })`
- attached rooms from `planRoomLinkStore`
- recent task/evidence/comments if available

Return a fully-renderable tree so Svelte does not have to reproduce projector
logic in the component.

This endpoint can ship before event persistence if it:

- reads `planModeStore` when available,
- groups tasks without a matching milestone under `unphasedTasks`,
- computes phase progress from milestone-linked tasks when present,
- falls back to task-only phases when there are no plan events.

## UI Contract

Change `/plans/[planId]` from Gantt-primary to cockpit-primary.

Recommended view tabs:

- `Cockpit` default
- `Gantt`
- `Retrospective`

Cockpit must include:

- plan title/description/lifecycle banner
- plan-level donut/progress
- phase/section list
- per-phase progress
- milestone cards with status, owner, acceptance, tests and evidence
- task rows under the relevant milestone or phase
- inline evidence/comment/activity stream per task
- room chips
- Gantt reachable as a secondary tab, not the title/default

Reuse/adapt from v3:

- `PlanView.svelte` grouping logic
- `ProgressRing.svelte`
- `ProgressBar.svelte`
- plan rail concepts

Reuse from v4:

- `PlanDonutCard.svelte` visual language
- `TaskDetailPanel.svelte`
- `PlanRetrospective.svelte`
- `planEvidenceStore`
- `planInsightsStore`

## Concrete Gaps

| Gap | Current State | Needed |
|---|---|---|
| Primary plan detail | `/plans/[id]` defaults to Gantt | Default to cockpit; Gantt secondary |
| Phase/task/milestone tree | Split between in-memory `PlanRoster` and persisted tasks | Single `/cockpit` projection |
| Donut/progress | Plan index only; Gantt summary text | Plan + phase + milestone progress in detail view |
| Evidence | Separate `/plans/evidence`; live rows currently empty | Inline evidence/comment rows in cockpit |
| Live updates | v3 had WS plan-event overlay; v4 cockpit absent | Subscribe cockpit to task/plan/evidence events or poll initially |
| Comments/activity | Not unified with plan detail | Recent agent evidence/comments per task/milestone |
| Plan events persistence | v4 `planModeStore` is in-memory | Either persist plan events or make task-based fallback strong |
| CLI semantics | v4 has plan/task verbs but split shapes | Document cockpit-compatible task/plan usage pattern |

## Suggested Slices

### #136a Server Projection

Build `GET /api/plans/:planId/cockpit` and tests. No UI change beyond
route smoke. This is the unblocker for Svelte.

Acceptance:

- returns plan, completion, rooms, phases, milestones, tasks, evidence,
  unphased tasks and recent activity keys
- works when there are no `planModeStore` events
- works when there are tasks but no evidence
- no service-side mutation

### #136b UI Cockpit Default

Make `/plans/[planId]` default to `Cockpit`, preserve Gantt as a tab.

Acceptance:

- first viewport shows plan title, donut/progress, phase list and active task
  summary
- Gantt remains available one click away
- no visible instruction text replacing the actual work surface

### #136c Live Evidence/Comments

Wire task/evidence/comment updates into the cockpit.

Acceptance:

- agent-created evidence or task status updates appear without a full
  navigation cycle
- if live push is too broad for this slice, short polling is acceptable as a
  temporary bridge

## Risks

- Reusing v3 `PlanView` directly may pull old Nocturne styling into the v4
  UI. The grouping model is worth lifting; the styling should be adapted to
  v4 tokens.
- Persisting `planModeStore` events is probably the right long-term fix, but
  it should not block the first cockpit restoration if the task-based fallback
  is good.
- A cockpit built only on tasks would miss acceptance/tests/decisions; a
  cockpit built only on `plan_*` events would miss v4 task reality. The merge
  endpoint is the important part.

## Current Live Evidence

- `/api/plans/completions?active=1` returns `v4-fresh-ant` as an active plan
  with 4 tasks and 0 complete.
- `/api/plans/v4-fresh-ant/tasks` returns 4 plan tasks with priority/status.
- `/api/plans/evidence?limit=5` returns no evidence rows.
- `/api/plans/insights` returns 11 plans, 13 tasks and 8 active plans.

## Recommendation

Ship #136a first. It gives Svelte a stable, testable cockpit data contract
and prevents another UI-only rebuild that hardcodes around missing data. Once
the endpoint is green, #136b can restore the primary planning cockpit without
touching the Gantt implementation beyond demoting it to a secondary tab.
