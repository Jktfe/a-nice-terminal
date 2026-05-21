# Lane D — PLANS: 3-level plans model + first-class task entity (decision-doc)

Status: DECISION-DOC (design slice, NOT impl). codex2-gate before impl.
Owner: researchant (lane D) · 2026-05-15.
Lifts: banked `project_plan_gantt_view_design_2026_05_15` (JWPK wireframe
IMG_0438 + donut-cards ask + Q1 data constraint). No re-questionnaire JWPK.
Grounded against current v4: `planModeStore.ts`, `PlanRoster.svelte`.

---

## 1. Current v4 state (the gap, measured)

`planModeStore.ts` (133L) = in-memory `Map<planId, PlanEvent[]>`, append-only
event log, projected per plan (`projectPlanEvents`, latest-per-identity-key).
`PlanEvent` carries `plan_id, kind (section|milestone|acceptance|test|
decision), status (PlanStatus), evidence: EvidenceRef[], milestone_id,
acceptance_id, parent_id, title`. `listKnownPlanIds()` enumerates plans.

**Gaps vs the banked 3-level spec:**
- NO task entity at all (plan events ≠ tasks; no priority, no dependency
  links, no assigned-agent field, no notes).
- NO persistence (in-memory; lost on restart — unlike ROOMS-PERSISTENCE which
  was moved to SQLite).
- Plans-index = `PlanRoster.svelte` shows effectively one plan; no
  multi-plan donut-completion cards.

## 2. Decision: a first-class `task` entity is the spine (JWPK Q1)

JWPK Q1 (banked, locked): **tasks are INDEPENDENT of plans** — a task MAY link
to a plan but MUST also exist standalone. Therefore the model is NOT
"plan-has-tasks"; it is:

> `task` = first-class persisted entity with an OPTIONAL `plan_id` link.

Plans remain the event-sourced milestone/acceptance structure (unchanged
`planModeStore`). The Gantt/board are **renders of the task entity**, filtered
by `plan_id`. This is the SAME task entity B2-7 tasks-board needs and that
FINGERPRINT-MANIFEST harvests into — one model, multiple input paths and
renders. We do not design a second task model.

### Proposed `tasks` schema (SQLite — persistence required)

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | |
| `subject` | TEXT NOT NULL | task name (level-3 title) |
| `description` | TEXT | level-3 plan content |
| `status` | TEXT | enum: `pending\|in_progress\|blocked\|completed\|deleted` |
| `priority` | INTEGER | JWPK "1/1/1/2/3", sortable/tickable; default null |
| `plan_id` | TEXT NULL | OPTIONAL link (Q1). NULL = standalone task |
| `assigned_agent` | TEXT NULL | `@handle` — Gantt bar hover-tooltip |
| `blocks` | TEXT JSON `[]` | task-id array — dependency arrows |
| `blocked_by` | TEXT JSON `[]` | task-id array (mirror of blocks) |
| `evidence` | TEXT JSON `[]` | reuse `EvidenceRef` shape from planModeStore |
| `notes` | TEXT | level-3 Notes section |
| `started_at_ms` / `ended_at_ms` | INTEGER NULL | Gantt bar extent |
| `created_at_ms` / `updated_at_ms` | INTEGER | |

Dependency vocabulary (`blocks`/`blocked_by` id arrays) is **deliberately the
claude `~/.claude/tasks/<sid>/*.json` shape** (FINGERPRINT-MANIFEST harvest) so
native-harvested and ANT-created tasks share ONE dependency graph.

## 3. The 3 levels → data each needs

**L1 Plans-index (donut cards).** For each `plan_id` in
`listKnownPlanIds()` ∪ `DISTINCT plan_id FROM tasks WHERE plan_id NOT NULL`:
card = { planId, title, completionPct }. **completionPct (D-INDEX)** =
`count(status=completed) / count(*)` over tasks with that `plan_id`.
Standalone tasks (`plan_id IS NULL`) are excluded from every plan donut and
get their own "Unfiled" board lane (not a donut).

**L2 Per-plan Gantt.** `tasks WHERE plan_id = :id`. Left table = `subject` +
`priority` (priority-sortable/tickable). Middle = bar per task spanning
`started_at_ms..ended_at_ms` (fallback when null: order by priority then
created_at, render equal-width sequence bars). Arrows = `blocked_by` edges.
Bar hover-tooltip = `assigned_agent`. Right filter panel = by `priority`, by
`assigned_agent` (client-side filter over the same task list).

**L3 Task-detail.** One task row: `subject`, `assigned_agent`, `description`
(plan content), `evidence[]` (EvidenceRef render — reuse), `notes`.

## 4. Open decisions for canonical/codex2 review (recommendations given)

- **D-PERSIST (recommend: SQLite `tasks` table).** Plan events stay in-memory
  in `planModeStore` (unchanged); the new `tasks` entity is SQLite-backed via
  the existing `db.ts` migration pattern (ROOMS-PERSISTENCE precedent). Tasks
  must survive restart; plan-event projection can remain ephemeral for now.
  Alt rejected: extending the in-memory plan map to carry tasks (loses Q1
  standalone-task independence + persistence).
- **D-DONUT (recommend: task-status ratio above).** completionPct from task
  status only. Alt: blend plan-event acceptance `status=passing/done` —
  deferred; needs a plan↔acceptance↔task mapping not in scope here.
- **D-DEPGRAPH (recommend: claude tasks shape, blocks/blocked_by id arrays).**
  Shared vocabulary with FINGERPRINT-MANIFEST harvest + B2-7. No new edge
  table; arrays on the row, validated server-side (no self-edge, ids exist).
- **D-CLI-SURFACE.** This conversation's `ant`/TaskCreate task list is the
  ANT-runtime coordination list. Recommend the lane-D `tasks` table is the
  SAME entity surfaced to B2-7; whether the `ant` CLI task verbs read/write
  this table is a B2-7 impl question, flagged not decided here.
- **D-AUTOMATION (out of scope, noted).** Lane D also owns the
  automation/watchers surface where ANTSCRIPT tasks later surface — those
  become rows in this `tasks` table with `assigned_agent` = the watcher.
  Design deferred to a later lane-D slice.

## 5. Sequencing & impl split

- This slice = decision-doc only. codex2-gate next.
- Impl after sign-off: **(S1)** `tasks` SQLite table + store
  (`taskStore.ts`: CRUD, dependency validation, list-by-plan, completion
  aggregation) + routes — researchant BE. **(S2)** L1 donut-index + L2 Gantt
  render (dependency arrows, agent tooltip, priority/agent filters,
  click-through) + L3 detail — claude2 FE (per banked lane split). **(S3)**
  B2-7 / FINGERPRINT harvest writes into the same table — composes, separate
  slice.
- Out of scope here: Gantt SVG/layout specifics, ANTSCRIPT automation,
  B2-7 harvest wiring.

## 6. Asks of review

1. Ratify the first-class `tasks` entity + §2 schema (esp. Q1 standalone +
   optional `plan_id`).
2. Decide **D-PERSIST** (recommend SQLite), **D-DONUT**, **D-DEPGRAPH**.
3. Accept **D-CLI-SURFACE** / **D-AUTOMATION** as flagged-deferred.
4. Confirm decision-doc → codex2-gate → S1/S2/S3 sequencing + the BE/FE split.
