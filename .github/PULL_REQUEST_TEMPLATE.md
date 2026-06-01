## What this changes

Brief summary. The "why" matters more than the "what" — the diff shows what.

## Scope check

- [ ] Narrowly scoped (one logical change, not a drive-by refactor bundle)
- [ ] No new dependencies without discussion
- [ ] No backwards-compatibility shims for code that hasn't shipped yet
- [ ] Comments only where the WHY is non-obvious

## Tests

- [ ] `bun test` (or `npx vitest run`) passes
- [ ] If touching auth/security surface: relevant audit harness re-run
  - [ ] `bash scripts/audit-auth-gates.sh` exit 0
  - [ ] `bash scripts/audit-auth-target-gaps.sh` exit 0
- [ ] If touching server lifecycle: `bash scripts/audit-server-down-fallback.sh` exit 0

## Reviewer notes

Anything reviewers should know that isn't obvious from the diff. Trade-offs
considered + rejected. Edge cases handled.

## Closes / refs

- Closes #
- Refs #
