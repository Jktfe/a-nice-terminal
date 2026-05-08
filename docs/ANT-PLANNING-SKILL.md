---
name: ant-planning
description: How to author, emit, view, and manage plans in ANT. Use when you need to create a structured plan with milestones/acceptances/tests, drive it through to completion, archive superseded plans, or render progress visually.
---

# ANT Planning

ANT plans are append-only event streams (`plan_*` run_events) that the
projector folds into a tree at view time. There is no "plans" table to
update — every state change emits a new event with the same identity,
and the projector keeps the latest by `ts_ms`.

## Anatomy

Five event kinds, all carrying a shared `plan_id` in the payload:

| Kind              | Identity field      | Purpose                                                                |
|-------------------|---------------------|------------------------------------------------------------------------|
| `plan_section`    | slug of title       | Top-level container; one or more per plan                              |
| `plan_milestone`  | `milestone_id`      | Work package inside a section                                          |
| `plan_acceptance` | `acceptance_id`     | Stable narrative criterion attached to a milestone                     |
| `plan_test`       | title slug          | Mutable verifiable check that proves the criterion                     |
| `plan_decision`   | title slug + parent | Compact decision row; sits in a section, carries provenance footnotes  |

`PlanStatus` union: `'planned' | 'active' | 'blocked' | 'passing' |
'failing' | 'done' | 'archived'`. Acceptances/milestones use
`active → done`. Tests use `planned → passing/failing`. Sections use
`planned → archived` for the archive lane.

## Wiring rules (read carefully — these bite)

1. **Every `plan_milestone` MUST set `parent_id`** to the section's
   slug (or any of its `eventAliases`). PlanView nests milestones via
   `belongsTo(section, milestone)`; orphans get caught by the
   `isOrphanForSection` resilience fallback only when there's a single
   section per plan, but rely on it sparingly. The body-render gate
   `isMilestonesSection(section)` falls through to "render whenever
   `milestonesForSection(section).length > 0`", so missing-parent
   milestones leave the rail counts diverged from the body.
2. **Every `plan_acceptance` and `plan_test` MUST set `milestone_id`**
   matching the parent milestone. They're nested by milestone_id, not
   parent_id, even though the field exists.
3. **Section slug aliases** include the slug of the title plus the
   `acceptance_id`. Use `acceptance_id` as a stable parent key when the
   title might rename.
4. **Re-emit to flip status** — emit a new event with the same identity
   and a different `status`. The projector dedupes by `ts_ms` so the
   latest wins. Never PATCH unless your CLI helper goes through
   `/api/plan/events/:id` (which exists for explicit row updates).

## Emitting a plan

Three options:

### CLI — none yet for the writer side

There's no `ant plan create` command today; planning is done via direct
HTTP POST to `/api/plan/events`, or via tooling helpers like a script
that batches `curl` calls. See `docs/agent-setup/state-schema.json`
adjacent surface for the plan event payload schema.

### Direct HTTP

```bash
curl -sk -X POST "$ANT_SERVER/api/plan/events" \
  -H "Content-Type: application/json" -H "x-api-key: $ANT_API_KEY" \
  -d '{
    "session_id": "<room-or-session-id>",
    "kind": "plan_section",
    "text": "Plan title",
    "payload": {
      "plan_id": "your-plan-id-2026-mm-dd",
      "title": "Plan title",
      "order": 0,
      "body": "One-paragraph description"
    }
  }'
```

Then milestones (note `parent_id` MUST equal the section slug):

```bash
curl ... -d '{
  "session_id": "...",
  "kind": "plan_milestone",
  "text": "M1",
  "payload": {
    "plan_id": "your-plan-id-2026-mm-dd",
    "parent_id": "plan-title",
    "milestone_id": "m1-foo",
    "title": "M1 Foo",
    "order": 1,
    "status": "planned"
  }
}'
```

### Bash batcher (the pattern used in this repo)

```bash
emit() {
  local kind="$1"; local payload="$2"; local text="$3"
  curl -sk -X POST "$SERVER/api/plan/events" \
    -H "Content-Type: application/json" -H "x-api-key: $KEY" \
    -d "{\"session_id\":\"$ROOM\",\"kind\":\"$kind\",\"text\":\"$text\",\"payload\":$payload}"
}
```

## Viewing a plan

### CLI

```
ant plan list                        # default: hides archived
ant plan list --include-archived     # includes archived rows tagged [archived]
ant plan show <plan_id> --session <id>
```

### Web

`/plan?session_id=<id>&plan_id=<plan>` — full PlanView with:

- Source bar at top (capped 720px): plan dropdown grouped Live / Archived,
  "Show archived plans" toggle, **archive plan / unarchive plan** action,
  + section, theme toggle.
- Plan header with `ProgressBar` showing "X of Y milestones done · NN%".
- Each section header with a smaller `ProgressBar` for that section's
  milestones.
- Sidebar `ProgressRing` (88px) centred on overall %.
- Per-milestone test `ProgressBar` (only renders when the milestone has
  `plan_test` events).

### Direct API

```
GET /api/plans                          # list
GET /api/plans?include_archived=1       # include archived
GET /api/plan?session_id=&plan_id=      # single plan events + archive flag
```

## Archive / unarchive

Archive is a status flip on the latest `plan_section`, not a new event
kind. Any plan with `status === 'archived'` on the latest section is
treated as archived plan-wide.

### CLI

```
ant plan archive <plan_id> --session <id>
ant plan unarchive <plan_id> --session <id>
```

### Top-bar control

The web /plan source bar shows a first-class **archive plan** /
**unarchive plan** button alongside the dropdown. Confirms before
flipping. Targets all archived section identities on unarchive, the
first section on archive (mirrors the server's `planArchiveStatus`).

### Section-meta control

`PlanView` also renders an inline **archive/unarchive** button in the
first section's meta row (edit mode only) — kept as a power-user
duplicate.

## Visual completion model

`isMilestoneDone(m)` counts `status === 'done' || status === 'passing'`.
Every progress visual rolls up that boolean:

- **Plan ProgressBar**: `doneCount / totalMilestones`
- **Section ProgressBar**: filtered to that section's milestones
- **Sidebar ProgressRing**: `overallPercent` with `X/Y` centre label
- **Per-milestone test ProgressBar**: `passing / tests.length`, danger
  variant when any test is failing

The components live at `src/lib/components/PlanView/{ProgressBar,ProgressRing}.svelte`
— Svelte 5, zero deps, ARIA-wired, `prefers-reduced-motion` respected.
Imported verbatim from `tfeSvelteTemplates` (do not modify locally; if
upstream changes, re-copy).

## Authoring conventions

- **Plan ID** = `<topic>-YYYY-MM-DD` (date-sortable, single source of
  truth across CLI/Web/API).
- **Section slug** = lowercase-kebab of title with non-alphanum
  collapsed to `-`. Used as `parent_id` everywhere downstream.
- **`order`** drives display order — start sections at 0, milestones
  at 1+, tests at 99+ so they sort to the end.
- **Status flips** — re-emit the FULL payload with the new status.
  Don't PATCH unless you specifically want the row's text/payload to
  change too.
- **Evidence refs** — attach `payload.evidence: [{ kind, ref, label }]`
  on milestones/acceptances/tests as work lands. Kinds: `run_event`,
  `raw_ref`, `task`, `source_url`, `file`. The web view renders these
  as links via `evidenceHref`.
- **Provenance refs** — `payload.provenance` documents *why* a decision
  was made. Each ref is `{ run_event_id?, fallback?: { source, author,
  section, query } }`.

## Multi-plan / multi-section etiquette

- One canonical plan per topic. If two agents emit competing plans,
  declare one canonical and flip the other's section to
  `status: 'archived'` with a `[SUPERSEDED]` title prefix and a body
  pointing at the canonical.
- Multi-section plans: keep them rare. The archive control targets the
  first section; section progress bars compute per-section.
- Cross-room visibility: `/api/agent-status/diag` is admin-only
  (`assertNotRoomScoped`); `/api/plan*` is room-scoped and per-session.

## Common pitfalls

| Pitfall                                                  | Symptom                                                                | Fix                                                            |
|----------------------------------------------------------|------------------------------------------------------------------------|----------------------------------------------------------------|
| Forgetting `parent_id` on `plan_milestone`               | Rail counts milestones, body shows none (orphan rendering only saves you with one section) | Set `parent_id` to section slug or `acceptance_id`             |
| Wrong `milestone_id` on acceptance/test                  | Acceptance/test never appears under the milestone                      | Match the parent milestone's `milestone_id` exactly            |
| Editing status via PATCH instead of re-emit              | Some clients fall behind because they fold by event-stream             | Re-emit the same identity with new status                      |
| Naming a section `milestones`                            | Works (special case path) but unhelpful elsewhere                      | Name sections after the work; trust the resilience fallback    |
| Hard-coding `'archived'` as a magic string in PlanStatus | Breaks future projector/types changes                                  | Import `PlanStatus` from `$lib/components/PlanView/types`      |

## Reference

- Schema: `src/lib/server/projector/types.ts` (server) +
  `src/lib/components/PlanView/types.ts` (UI). Keep in sync.
- Projector: `src/lib/server/projector/plan-view.ts` —
  `listPlanRefs`, `getPlanViewData`, `planArchiveStatus`,
  `parseIncludeArchived`.
- Emit endpoint: `src/routes/api/plan/events/+server.ts` (POST/PATCH).
- View endpoint: `src/routes/api/plan/+server.ts` and
  `src/routes/api/plans/+server.ts`.
- UI: `src/lib/components/PlanView/PlanView.svelte` +
  `src/routes/plan/+page.svelte`.
- Tests: `tests/plan-events-api.test.ts`,
  `tests/plan-projector.test.ts`, `tests/plan-live-api.test.ts`,
  `tests/plan-cli.test.ts`, `tests/plan-view-render.test.ts`.

## Worked example — three commits to ship a plan end-to-end

1. **Author**: emit `plan_section` + `plan_milestone`s with
   `parent_id` wired, `plan_acceptance` + `plan_test` per milestone.
2. **Drive**: as work lands, re-emit acceptances/tests with
   `status: 'active'` → `'done' | 'passing'`, attach `evidence` refs
   pointing at files / commits / docs.
3. **Close**: when every milestone is `done` and every test is
   `passing`, the overall ProgressBar/Ring goes 100% emerald. If the
   plan is later superseded, archive it via the top-bar control or
   `ant plan archive <plan_id>`.

This is the same pattern the `status-parity-2026-05-07` and
`plan-management-2026-05-08` plans followed in this repo — read either
for a worked example.
