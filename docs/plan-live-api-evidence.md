# Plan Live API Evidence

Branch: `delivery/plan-live-api`

Worktree: `../a-nice-terminal-plan-live-api`

## Scope

- Added `GET /api/plan` as a thin live-data route over the existing `queries.getPlanEvents` helper.
- Added `/plan` server load so Plan View reads live `plan_*` run_events when available and explicitly falls back to the sample fixture when no live plan exists.
- Route returns `{ session_id, plan_id, limit, count, events, errors }`.
- `events` are normalized for Plan View as `id`, `session_id`, `ts`, `ts_ms`, `source`, `trust`, `kind`, `text`, `payload`, `raw_ref`, and `created_at`.
- Invalid plan payloads are reported in `errors` and are not silently returned as usable Plan View events.
- Plan View shows a small Live/Sample source selector for discovered plans.

## Verification

Commands run from the Plan Live API worktree under Node 20:

```bash
PATH="$HOME/.nvm/versions/node/v20.19.4/bin:$PATH" npm exec vitest -- tests/plan-projector.test.ts tests/plan-live-api.test.ts --run
# PASS: 2 files / 11 tests

PATH="$HOME/.nvm/versions/node/v20.19.4/bin:$PATH" npm exec svelte-check -- --tsconfig ./tsconfig.json
# PASS: 0 errors / 0 warnings

PATH="$HOME/.nvm/versions/node/v20.19.4/bin:$PATH" npm exec vite build
# PASS
```
