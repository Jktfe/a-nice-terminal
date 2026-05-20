# Plan‑Visible Design Sketch – 2026‑05‑13

## Purpose
The **plan‑visible** slice is a lightweight, read‑only surface that exposes the progression of critical slices (e.g. PTY‑INJECT‑0, A, B) to the JWPK monitor.  It is deliberately separate from PTY‑INJECT‑0 so that deployment prioritisation can be controlled independently.

## Scope
* Only the *visible* state of slices is rendered – no write or mutation logic.
* The surface is a **static markdown** file generated from:
  * Filesystem scan of `/Users/jamesking/CascadeProjects/ant/docs`.
  * Scrape of the recent ant‑chat history for status updates.
  * Optional plan store (e.g. a JSON file under `plan-store/`).
* The output is aimed at JWPK; it is not exposed to the public API.

## Options Table
| Slice | Status | Visibility Note |
|-------|--------|-----------------
| PTY‑INJECT‑0 | `PASS` | Shown as ✅
| PTY‑INJECT‑A | `CODE‑PASS` | Shown as ✅
| PTY‑INJECT‑B | `BEHAVIORAL PASS` (formal PASS pending) | Shown as ⚠️ until formal PASS
| PTY‑INJECT‑C | `TODO` | Hidden (pending) |

The table can be expanded as new slices are introduced.

## Data Sources
1. **Filesystem scan** – `ls -R` of the `docs/` directory to capture existing design‑contract and plan files.
2. **Chat history scrape** – `ant chat --history 24h` (or similar) to extract the latest status tokens.
3. **Plan store** – optional JSON under `plan-store/` containing `{slice: status, timestamp}` entries.

## Plan Store (Optional)
If a dedicated plan store is desired, place a `plan-state.json` in the root of the project:
```json
{
  "PTY‑INJECT‑B": {"status":"BEHAVIORAL PASS", "timestamp":"2026-05‑13T12:34Z"}
}
```
The script will merge this with chat‑derived status.

## Hybrid Recommendation
Render the table as a **markdown table** for quick copy‑paste into Slack or the JWPK dashboard.  For richer UI, expose a tiny Svelte component that reads this file and updates in real time.

## Do‑Not‑Use
* Avoid embedding private credentials or secrets.
* Do not expose this file to public repositories; keep it under `.gitignore`.

## Open Questions for JWPK
1. Should we add a *progress bar* visualising overall completion?
2. Is the `BEHAVIORAL PASS` marker sufficient, or do we need a *formal* flag?
3. What is the desired refresh cadence for the plan surface?

## Honesty Section
The current design intentionally **excludes** any logic that mutates state.  It is a *snapshot* view only, derived from static sources and chat tokens.  Future iterations may add real‑time updates via WebSocket if needed.

---
**Author:** James King (JWPK) | **Date:** 2026‑05‑13