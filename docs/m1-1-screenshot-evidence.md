# M1 #1 — Screenshot Capture: Acceptance Evidence

> **Acceptance test** — "An agent or contributor can capture a desktop screenshot for a given session and have the result anchored as a high-trust `run_event` row."

Companions: `docs/m6-1-visual-qa-evidence.md`, `docs/m3-shared-artifact-evidence.md`.

---

## What landed

Two-piece slice: a DI-friendly capture helper and a CLI subcommand that exercises it.

- **Capture helper** — `src/lib/server/capture/screenshot.ts` (commits `379c42b`, `8e5cc6c`, `557ebfc`).
  - `captureScreenshot(sessionId, outputDir, deps)` returns `{ path, sha256, bytes, tsMs }`.
  - All side-effects (`execFile`, `readFile`, `createHash`, `nowMs`, `mkdir`, `insertRunEvent`) are injected via the `ScreenshotDeps` interface so the unit tests never shell out to `screencapture` and never touch the disk.
  - Filenames follow `screenshot-<sessionId>-<tsMs>.png` so two captures in the same second produce distinct paths.
  - On success the helper inserts a `run_event` with `source='hook'`, `trust='high'`, `kind='screenshot'`, and a JSON payload containing `path`, `sha256`, `bytes`.
- **CLI subcommand** — `cli/commands/evidence.ts` (commit `379c42b`).
  - `ant evidence screenshot <session-id>` writes into `~/.ant-v3/evidence/screenshots/` by default; `--dir /path` overrides.
  - `--json` dumps the helper result as JSON for scripted callers; the default human output prints path, SHA-256, and byte count.
  - Wired into `cli/index.ts` with help text alongside `ant evidence visual-baseline` (M6 #1).
- **Hasher follow-up** — `src/lib/server/capture/screenshot.ts` line 47 (commit `557ebfc`).
  - The original code chained `createHash('sha256').update(buffer).digest('hex')`. An interim type-fix at `8e5cc6c` split that across three statements when I misread the error. kimiant later widened the `createHash` interface to chainable form for M6 #2 PWA's hasher path; `557ebfc` re-chained line 47 to match what the unit tests had always expected.

Authored by @kimiant; cherry-picked to `main` as `379c42b`. Type-check ratchet at `8e5cc6c` and `557ebfc`.

---

## Tests

Four cases in `tests/screenshot-capture.test.ts`:

1. **Happy path** — verifies returned `path` matches `<sessionId>-<tsMs>.png`, `sha256` matches the mock digest, `bytes` matches the mock buffer length, and that exactly one `run_event` is recorded with the expected `source/trust/kind/text/payload` shape.
2. **Filename uniqueness** — two consecutive calls with monotonically advancing `nowMs()` produce distinct paths.
3. **Error propagation** — when `execFile` throws, `captureScreenshot` rejects with the same error message; no `run_event` is emitted.
4. **mkdir call** — confirms `deps.mkdir(outputDir)` runs before the capture so a fresh evidence directory works on the first run.

All four pass on `main` (428 total / 1 skip / 0 fail; svelte-check 807 / 0 / 0).

---

## How a contributor uses it

```
ant evidence screenshot ant-r4
```

Output:

- One PNG in `~/.ant-v3/evidence/screenshots/screenshot-ant-r4-<tsMs>.png`.
- One row in `run_events` with `kind=screenshot`, `trust=high`, attributable to the session and the captured frame.

The `run_events` row is the trust anchor — it survives a workspace deletion, gives the plan view a verifiable evidence trace, and pairs with the visual-QA pipeline (M6 #1) so a reviewer can correlate a desktop screenshot with the in-app baseline.

---

## What this gives us

- ANT can now capture *any* desktop state into evidence, not just app states drivable by Playwright. Useful for cross-app workflows (terminal + browser + finder) that the in-app capture can't reach.
- The DI shape means future surfaces (MCP tool, autonomous-agent trigger, pre-commit hook) can call `captureScreenshot()` without re-implementing the hash + run_event plumbing.
- The chainable `createHash` interface (validated by the M1 #1 test from day one) is now consistent across `M1 #1` screenshot, `M6 #2` service-worker hasher, and any future hash users.

---

## Open

- Cross-platform parity: `screencapture` is macOS-only; a Linux/Windows path is unscoped.
- A `--region` flag for partial captures.
- Cleanup policy for the screenshots directory once it fills up.
