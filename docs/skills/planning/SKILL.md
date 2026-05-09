---
name: planning
description: Compact ANT planning primer for agents that need to create, update, review, or close plan-backed work without rereading the long docs.
aliases: [plan, plantools, planningtools]
---

# ANT Planning Skill

Use this when the user says "use ANT planning", asks for a lane, or wants
work tracked in the plan page. Keep the plan short, visible, and factual.

## Golden Rules

1. One lane, one canonical `plan_id`. Archive duplicates quickly.
2. Create linked tasks for each milestone with `--plan` and `--milestone`.
3. Keep status true. Do not call work done until evidence is real.
4. Mark stale or superseded plans archived, not deleted.
5. Use the room as shared truth: post short status updates when lanes move.

## Minimal Workflow

Choose a dated slug:

```bash
PLAN=my-feature-2026-05-09
ROOM=<room-id>
```

Create tasks linked to milestones:

```bash
ant task "$ROOM" create "M1 audit current behaviour" \
  --desc "Plan $PLAN m1. Inspect code, live behaviour, and risks." \
  --plan "$PLAN" --milestone m1-audit

ant task "$ROOM" create "M2 implement narrow fix" \
  --desc "Plan $PLAN m2. Patch only the agreed files and add tests." \
  --plan "$PLAN" --milestone m2-implement
```

Show the plan:

```bash
ant plan show "$PLAN" --session "$ROOM"
```

Complete tasks with the visible short id:

```bash
ant task "$ROOM" done <short-id>
```

Archive stale plans:

```bash
ant plan archive "$PLAN" --session "$ROOM"
```

## Plan Events

Plans are append-only `plan_*` events. There is no mutable plan row.
To flip state, emit a new event with the same identity and later `ts_ms`.

Core event kinds:

- `plan_section` groups the plan.
- `plan_milestone` is the work package.
- `plan_acceptance` is the human-readable criterion.
- `plan_test` is the verifiable check.
- `plan_decision` captures a decision with provenance.

Important fields:

- Every payload needs `plan_id`, `title`, `order`.
- Milestones need stable `milestone_id`.
- Acceptances and tests need matching `milestone_id`.
- Use statuses: `planned`, `active`, `blocked`, `done`, `passing`,
  `failing`, `archived`.

## Lane Discipline

- Claim only what you will edit.
- If another agent owns adjacent files, say so and stay out.
- If work crosses files or risk boundaries, split into milestones.
- If the lane is audit-only, write the audit and stop.
- If the user says "go for it", execute the plan rather than re-asking.

## Evidence

Close with proof:

- focused tests and full relevant gate results;
- commit hash when pushed;
- live smoke result when UI/ANT room behaviour matters;
- plan/task ids flipped in ANT.

Long form: `docs/ANT-PLANNING-SKILL.md`.
