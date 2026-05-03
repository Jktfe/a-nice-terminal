# Plan Live API Evidence

Branch: `delivery/plan-live-api`

Worktree: `../a-nice-terminal-plan-live-api`

## Scope

- Added `GET /api/plan` as a thin live-data route over the existing `queries.getPlanEvents` helper.
- Route returns `{ session_id, plan_id, limit, count, events, errors }`.
- `events` are normalized for Plan View as `id`, `session_id`, `ts`, `ts_ms`, `source`, `trust`, `kind`, `text`, `payload`, `raw_ref`, and `created_at`.
- Invalid plan payloads are reported in `errors` and are not silently returned as usable Plan View events.
- No Plan View UI files are part of this route commit.

## Verification

Commands run from the Plan Live API worktree under Node 20:

```bash
env PATH=/Users/jamesking/.nvm/versions/node/v20.19.5/bin:$PATH ./node_modules/.bin/vitest run tests/plan-live-api.test.ts tests/plan-projector.test.ts
# PASS: 2 files / 10 tests

env PATH=/Users/jamesking/.nvm/versions/node/v20.19.5/bin:$PATH ./node_modules/.bin/vitest run
# PASS: 18 files passed / 1 skipped, 105 tests passed / 1 skipped

./node_modules/.bin/svelte-kit sync
env PATH=/Users/jamesking/.nvm/versions/node/v20.19.5/bin:$PATH npx --yes svelte-check
# PASS: 0 errors / 0 warnings
```
