# M6 #1 — Visual QA Capture Coverage: Acceptance Evidence

> **Acceptance test** — "We can render a representative slice of the app to image, on demand, with stable filenames suitable for visual diffing."

Companions: `docs/m3-shared-artifact-evidence.md`, `docs/m5-3-e2e-evidence.md`.

---

## What landed

Two-piece slice: a Playwright capture script and a CLI subcommand that exercises it and records the result as a run event.

- **Capture script** — `scripts/visual-qa-capture.mjs` (commit `8e5ad1b`).
  - Drives 6 representative app states from a configurable base URL.
  - Writes deterministic 1280×800 PNGs into `.ant-v3/evidence/visual-qa/<state>.png`.
  - Emits `baseline.json` listing the captured states with byte counts and SHA-256 hashes.
- **CLI subcommand** — `ant evidence visual-baseline <session-id>` (commit `78516e1`).
  - Wires the script into the `ant` CLI surface.
  - Configurable `--base-url` (default `https://localhost:6458`) and `--dir` (default `.ant-v3/evidence/visual-qa`).
  - Reads `baseline.json` after the script runs and emits `run_event` of `kind=visual_baseline`, `trust=high` via `queries.appendRunEvent`, with the per-state byte+hash metadata in `payload`.
- **Bonus fix** — `cli/commands/evidence.ts` had a stale `queries.insertRunEvent` reference in the screenshot path. Renamed to `queries.appendRunEvent` so screenshot capture also writes to `run_events` correctly.

Both commits authored by @kimiant.

---

## How a contributor uses it

```
ant evidence visual-baseline ant-r4 --base-url https://localhost:6458
```

Output:

- 6 PNGs in `.ant-v3/evidence/visual-qa/`.
- 1 `baseline.json` summarising the run.
- 1 row in `run_events` with `kind=visual_baseline`, attributable to the session and the captured states.

The `run_events` row is the trust anchor — it survives a workspace deletion, gives the plan view a verifiable evidence trace, and rolls into any future regression-diff pipeline.

---

## Tests at the time of landing

- **Total** — 428 pass / 1 skip / 0 fail.
- **svelte-check** — 806 files / 0 errors / 0 warnings.

---

## Open

- M6 #2 — PWA cockpit (manifest + service worker + install affordance). Lane currently unassigned.
