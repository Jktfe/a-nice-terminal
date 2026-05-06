# M5 #3 — Interview E2E Test: Acceptance Evidence

> **Acceptance test** — "Full claim → answer → publish-summary loop verified end-to-end with WS-broadcast assertions."

Companion: `docs/m3-shared-artifact-evidence.md` (consent + transport), `docs/security-model.md` (M5 #2).

---

## What landed

Single test file scaffold that drives the whole interview workflow against a real DB + a fake WS client capturing broadcasts.

- **File** — `tests/e2e-claim-answer-summary.test.ts` (284 lines).
- **Commit** — `092ad23` on `deepseek/m5-e2e`, cherry-picked to `main` as `53a9b93`.
- **Author** — @deepant.

Three test cases, all passing on `main`:

1. **Full lifecycle** — creates terminal + chat sessions, links them as an interview, creates and claims a task, posts a message that triggers ask fan-out, resolves the asks, builds a publish-summary via the pure helper, asserts WS broadcasts fire at claim, message, and ask-resolution stages.
2. **Workspace isolation** — two cases run back-to-back share no state; the fresh-workspace pattern (mkdtemp + ANT_DATA_DIR swap + `_resetForTest()`) prevents leakage.
3. **WS event coverage** — explicit assertions on `task_updated`, `ask_created`, and `ask_updated` event kinds.

---

## How the test stays honest

| Concern | What the test does |
| --- | --- |
| Accidentally hitting prod DB | `mkdtemp` + `process.env.ANT_DATA_DIR` swap on every test, then `resetDbForTest()` to drop the cached singleton. |
| Stale singleton state | `_resetForTest()` exported from `src/lib/server/db.ts` clears the better-sqlite3 / bun:sqlite handle and re-initialises against the temp dir. |
| WS broadcast goes to nowhere | `registerClient()` is called with a fake client that pushes every message into a captured array; assertions inspect the array, not the broadcast machinery. |
| Async ordering bugs | Each step awaits before assertions; final assertions run only after the publish-summary helper has returned. |

---

## Tests at the time of landing

- **Total** — 428 pass / 1 skip / 0 fail (after cherry-pick + cherry-pick of M6 #1 visual-baseline subcommand on top).
- **svelte-check** — 806 files / 0 errors / 0 warnings.

---

## What this gives us

- Anyone touching the consent fan-out, task-claim path, or publish-summary helper now has a smoke test that exercises the whole loop. If a regression breaks any link in the chain, this test fails before review.
- The fresh-workspace pattern is now reusable for every future E2E test. M5 #4 (cross-machine pilot) can boot two ANT_DATA_DIR-isolated workspaces and use the same scaffold.

---

## Open

- M5 #4 cross-machine consent pilot — boot two workspaces, prove a grant created on one is honoured by the other. Awaiting worktree assignment.
