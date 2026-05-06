# M4 — Cross-Machine Consent Pilot: Acceptance Evidence

> **Acceptance test** — "A consent grant created on instance A is honoured (or revoked) on instance B for the same room, with grant-state assertions covering grant, exhaustion, and revoke transitions."

Companions: `docs/m3-shared-artifact-evidence.md`, `docs/m5-3-e2e-evidence.md`.

This slice was originally tracked twice — as M4 "cross-machine pilots" and as M5 #4 "cross-machine consent pilot". They were the same acceptance test under different lane names. M4.1 below closes both.

---

## What landed

One E2E test file exercising the full grant lifecycle across the room boundary, plus one ordering-bug fix.

- **E2E test** — `tests/cross-machine-consent.test.ts` (commit `ac57212`).
  - Three test cases, all using a fresh-workspace pattern (`mkdtemp` + `ANT_DATA_DIR` + `_resetForTest`) so each starts from an empty SQLite DB representing the shared room.
  - Treats "instance A" and "instance B" as two API-level callers against the same room store. The test does not spin two TCP servers; the cross-machine contract is exercised at the route-handler level so it stays deterministic and fast (~140 ms).
  - The room invite + token-exchange ceremony is real: A creates the invite + password hash, B calls `exchangePassword` with the password to receive a token and is registered as a room member.
  - The consent grant is created via `buildConsentGrant` + `queries.createConsentGrant` — the same primitives that landed in M3 #1 / #3.
  - The fan-out gate is exercised via `consentGateAsk` with a DI `ConsentGateQueries` shim wired to the real DB queries.
- **afterEach ordering fix** — `tests/cross-machine-consent.test.ts` lines 65–69 (commit `098a61f`).
  - Original cleanup only restored env vars per-test and deferred tmpdir removal to `afterAll`. The cached db singleton kept its handle to the last freshWorkspace tmpdir, so when `afterAll` deleted those dirs the next test file in the suite got `SQLiteError: disk I/O error` on `getDb()`.
  - Fix mirrors `tests/upload-hardening.test.ts:69`: `restoreEnv() → resetDbForTest() → rm tempDirs` all in a single `afterEach`. Drops the `afterAll` hook entirely.
  - 11 downstream tests (deck-files, session-export-plugins) were the canary; all pass after the fix.

Authored by @glmant; cherry-picked to `main` as `ac57212` with the ordering follow-up at `098a61f`.

---

## Tests

Three cases in `tests/cross-machine-consent.test.ts`:

1. **Full lifecycle** — A creates room + invite, B exchanges the password for a token, A creates a grant, B's inferred ask is auto-answered (`answer_count` bumps from 0 → 1), A revokes the grant, B's next ask gets `no_grant` (revoked grants are invisible to the active filter).
2. **Token scope** — invite token exchange is gated by `kinds` allowlist: a `cli`-only invite rejects a `mcp` token request, even with the correct password.
3. **Grant exhaustion** — `max_answers=2`; the third ask against the same grant is dismissed with `exhausted` and the grant transitions to `exhausted` status.

All three pass on `main`: 431 total / 1 skip / 0 fail; svelte-check 808 / 0 / 0.

---

## How a contributor verifies it

```
bun test ./tests/cross-machine-consent.test.ts
```

Three pass / 0 fail. The fresh-workspace pattern means there's no state to clean between runs — each invocation gets its own temp DB and tears it down on `afterEach`.

---

## What this gives us

- Demonstrates that the M3 consent primitives (grant schema + helpers + lifecycle CLI) compose end-to-end across the room boundary, not just within a single session.
- The room-invite + token-exchange ceremony is exercised in the same test, so any future regression in that path will fail here too.
- The single-DB simulation is honest about what we can prove on a one-machine deployment: the *contract* between A and B is provable; an actual two-machine WAN test would need the same contract over the network and is left as a follow-on.
- The ordering fix at `098a61f` is now the canonical fresh-workspace pattern for any future test that uses `freshWorkspace` + tmpdirs (alongside `upload-hardening.test.ts`).

---

## Open

- True two-instance test with separate sqlite DBs and a sync transport between them — only meaningful once a sync transport ships, which is out-of-scope for the pilot.
- A cross-room grant-isolation case (a grant on room X must not leak to room Y); currently implied by the schema but not asserted.
