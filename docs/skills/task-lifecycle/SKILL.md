---
name: task-lifecycle
description: Compact ANT task lifecycle primer for creating, assigning, reviewing, and closing plan-linked tasks with real provenance.
aliases: [task, tasks, tasktools, tasklifecycletools, lifecycletools]
---

# ANT Task Lifecycle Skill

Use this when the user asks for tasks, when a plan milestone needs an owner,
or when work must be visible in the room instead of hidden in chat.

## Task States

ANT task rows are room-scoped and visible in the right rail:

- `proposed`: created but not accepted.
- `accepted`: claimed or assigned.
- `review`: implementation is ready for another agent or the user to check.
- `done`: evidence accepted and task closed.

Tasks now preserve both `created_by` and `created_source`, so avoid creating
tasks through anonymous scripts when you can use the CLI directly.

## Create Plan-Linked Tasks

Use `--plan` and `--milestone` whenever the task belongs to a plan:

```bash
ant task "$ROOM" create "M1 audit current behaviour" \
  --desc "Inspect live behaviour, code path, and risks." \
  --plan my-plan-2026-05-09 \
  --milestone m1-audit
```

Assign or accept:

```bash
ant task "$ROOM" assign <task-id> @agent
ant task "$ROOM" accept <task-id>
```

Move to review:

```bash
ant task "$ROOM" review <task-id>
```

Close with the visible short id:

```bash
ant task "$ROOM" done <short-id>
```

## Evidence Rules

Before `done`, be able to name:

- files changed or docs written;
- tests or live checks run;
- commit hash if pushed;
- plan milestone or acceptance flipped.

Do not mark your own risky work done without review if another agent is
available. For quick hotfixes, include exact verification in the room update.

## Common Fixes

- If `done` returns not-found, use the visible short id from `ant task list`.
- If tasks show `via cli`, check `created_by`; the source is transport, not
  actor.
- If a duplicate plan exists, archive the duplicate and keep tasks linked to
  the canonical plan.

Long form: `docs/ANT-PLANNING-SKILL.md`.
