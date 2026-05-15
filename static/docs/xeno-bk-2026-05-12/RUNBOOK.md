# Xeno BK meeting runbook — 2026-05-12

> **Repo mirror of the ANT doc `xeno-bk-meeting-runbook-2026-05-12`** (per evolveantcodex's "if both, repo Markdown is source" rule). This file and the ANT doc carry the same content. The ANT doc is the room-facing surface; this file is the source-controlled, anyone-can-clone version. Update both when changing.
>
> **The single thing to open first if you're walking through this tomorrow.** Every other artefact is reachable from the `Links` section at the bottom.

---

## Start here

The xenoMCP BK meeting pack for 2026-05-12. Open this runbook first.

Twelve days ago this work did not exist; today the repo ships at [github.com/Jktfe/xenoMCP](https://github.com/Jktfe/xenoMCP) with three releases:

- [`v1.0.0`](https://github.com/Jktfe/xenoMCP/releases/tag/v1.0.0) — 16 baseline tools wrapping TimeScape's full CPython surface.
- [`v1.1.0-preview`](https://github.com/Jktfe/xenoMCP/releases/tag/v1.1.0-preview) — first v1.5 DCO Visibility tool live.
- **[`v1.1.0-preview.2`](https://github.com/Jktfe/xenoMCP/releases/tag/v1.1.0-preview.2) — all five v1.5 tools live, 21 tools total, 44 cross-platform tests.**

**The big narrative pivot for the meeting**: we did not just describe v1.5, we built it. Two of the five v1.5 tools return real data today (`vendor_entitlement_audit`, `dco_optimisation_decisions`); three return structure-only with `unmet_dependencies: ["baselineMethod"]` and flip from `null` to real numbers the day after Brian answers the cost-baseline question.

**Navigation**:
- [Deck](#deck) — 12-slide narrative
- [Demo](#demo) — 7-minute live demo plan
- [QA](#qa) — anticipated questions and the hand-to-Brian one-pager
- [Risk](#risk) — binding security and compliance non-negotiables
- [Links](#links) — repo paths and release URLs

Plan scoreboard (live state of work for the meeting): `ant task w5hMngV_jp8k5NmRcPVya list` — five tasks across milestones M0-M4.

---

## Deck

**Primary demo surface for James**: [`docs/mockups/bk-meeting-presentation.html`](mockups/bk-meeting-presentation.html) — self-contained single HTML file rendering all 12 slides + embedded DCO mockup + 14-card links grid, branded with XenomorphDesignSystem tokens. Open in any browser; sticky nav lets you jump between slides; speaker notes fold into expandable `<details>` elements. Cmd+P → Save as PDF gives a take-away document for Brian if needed.

The 12-slide deck **source** lives at [`docs/deck/`](deck/) — Markdown per slide, with speaker notes in HTML comments at the bottom of each slide. Files `01-cover.md` through `12-path-forward.md`, plus `index.md` manifest.

**Narrative thread** (from `@xenoCC`): *"BK sees the engineering daily — what he has never seen is what their tech feels like with modern presentation on top."* Lean into the contrast.

All five v1.5 DCO Visibility tools shipped via `v1.1.0-preview.2`: two return real data today, three return structure-only until the cost-baseline conversation lands.

**Slide-by-slide**:
1. Cover — Your platform. Brought to the AI surface.
2. The proposition — platform is excellent; presentation hasn't kept up.
3. What you've built — 30 years; five pillars; QL+ + four validation classes.
4. The architecture — Raw → Silver → Gold tiers; SQL Server; CPython binding as the door.
5. The customers — five verified deployments (Mizuho Americas, Mediobanca, Rabobank, AllianzGI risklab, HSBC); anonymised outcome metrics.
6. The compliance lane — BCBS 239 / FRTB / IPV-MCC / BaFin / DORA / T+1. The platform isn't catching up to compliance — compliance is catching up to the platform.
7. Vendor Cost Management + DCO — Keith's strategic gap (DCO saves millions but Xeno doesn't surface the savings).
8. The market right now — three forces (AI/MCP wave incl. KX KDB-X · cloud-native disruption incl. FINBOURNE LUSID/EDM+ naming clash · regulatory tailwinds).
9. What we built atop this week — 21 tools live, `BP.L = 508.0` round-trip code block; v1.0.0 → v1.1.0-preview → v1.1.0-preview.2.
10. **DCO Visibility v1.5** — all five tools live (2 real-data, 3 structure-only); four questions for Brian; "the shape doesn't change when answers land, only the figures fill in".
11. AI-fluent surface thesis — Matt Pick's "AI is only as good as the underlying data" + the Claude-Desktop natural-language example + v2/v3 capability-graph + cross-source federation.
12. Path forward — delivered today / 30 / 60 / 90 day milestones; six open questions; closing bookend.

---

## Demo

**7-minute live demo plan**: [`docs/DEMO_SCRIPT.md`](DEMO_SCRIPT.md). Six moments + v1.5 preview + closer + risk pre-empts. **Owned by `@xenoCC`** under milestone `m2-demo-script` in the plan. Evidence already pushed: [`docs/demo_dry_run.py`](demo_dry_run.py) runs every dry-runnable moment automatically — **9 of 9 PASS** against live TimeScape v5.0 + `xenomorph-mcp.exe v1.1.0-preview.2`.

**Six moments**:
1. **Connection check** — "What version of TimeScape are we connected to?" → `version` tool → `5.0`.
2. **Instrument read** — "Show me the close price for BP.L in the XENO database." → `itemQuery` → `("BP.L", "BP", 508.0)`.
3. **Free-form QL+ from natural language** — Claude composes `Item(%database%, %code%).Close.LastValue` and calls `query` → `508.0`.
4. **Write attempt that refuses without confirm** — `saveItem` returns `needs_confirmation: true` with full preview; no write executed.
5. **Approve-and-execute** — `saveItem` with `confirm=true` runs; audit log shows the two-step trace.
6. **Clean-up delete** — `deleteItem` with `confirm=true`; same gating pattern as writes.

Plus a **BK-drives-himself five-prompt sticky-note flow** for the moment when Brian wants to type at the laptop himself.

Four **analyst-workflow examples** in [`docs/examples/`](examples/) pair with the script for self-driven exploration after the meeting:
- `01-lookup-instrument.md`
- `02-cross-source-prices.md`
- `03-back-fill-series.md`
- `04-validation-task.md`

---

## QA

Three Q&A artefacts, each for a different moment:

1. **[`docs/OPEN_QUESTIONS_FOR_BK.md`](OPEN_QUESTIONS_FOR_BK.md)** (52 lines) — one-pager with P0/P1 priorities. **The artefact James hands Brian to take away.**
2. **[`docs/BK_QUESTIONS_FULL.md`](BK_QUESTIONS_FULL.md)** (205 lines) — full tracker for James's reference with status badges (`[v1.5-blocker]` / `[v1.5-degrades]` / `[zero-cost]`). James's reference, not Brian's.
3. **[`docs/BK_FAQ.md`](BK_FAQ.md)** — 40 anticipated questions across 9 categories: Safety/governance · Architecture · Operational · Roadmap · Commercial · Competitive · Implementation depth · Failure modes · The disarming questions.

**Owned by `@xenoCodex`** under milestone `m3-qa-risk-pack` in the plan.

---

## Risk

**Security and compliance non-negotiables** — binding for everything that ships:

- [`docs/research/KEITH_NEEDS_TODAY.md`](research/KEITH_NEEDS_TODAY.md) — `@xenoCodex` authored. Safe-vs-not-show split. Compliance checklist.
- [`docs/CONTRACT.md`](CONTRACT.md) — §0 Tenancy isolation foundational rule + Appendix B pre-publish compliance checklist.

**Hard rails**:
- **Customer-data-only.** No Xenomorph internal data, no cross-tenant aggregates, no other clients' data.
- **Tenant-scoped via Integrated Auth** (Kerberos / AD).
- **No central data exhaust** — audit logs stay on the customer host, never centralised at Xenomorph.
- **Baseline discipline** — every savings figure names its baseline and window. Vague savings figures are a contract violation by design.
- **Read/write separation** — 4 read tools open by default; 11 write/destructive/config/batch tools gated by `confirm=true` + audit + four-eyes (planned v1.1 layer for destructive).
- **Never modify Xenomorph code, only build atop.** Hard rail repeated three times: cover, proposition, slide 9. The platform stays exactly as it is.

**Three v1.5 tools that return `null` amounts do so explicitly** because no defensible baseline exists yet — this is a feature not a bug. The cost-reference question for Brian is what flips them on.

---

## Links

**Repo + releases**:
- [github.com/Jktfe/xenoMCP](https://github.com/Jktfe/xenoMCP) (private)
- [Release v1.0.0](https://github.com/Jktfe/xenoMCP/releases/tag/v1.0.0) — baseline 16 tools
- [Release v1.1.0-preview](https://github.com/Jktfe/xenoMCP/releases/tag/v1.1.0-preview) — first v1.5 tool live
- **[Release v1.1.0-preview.2](https://github.com/Jktfe/xenoMCP/releases/tag/v1.1.0-preview.2) — all five v1.5 tools live**

**Local paths**:
- Mac mini: `~/CascadeProjects/xenoMCP/`
- Windows host (`@xenoCC`): `C:\Users\jking\Documents\nmdev\xenomorph-mcp\` (kebab-case dir; repo name is camelCase `xenoMCP`)

**Plan scoreboard**:
- `ant task w5hMngV_jp8k5NmRcPVya list` — live state of all 5 milestone tasks
- `ant doc get xeno-bk-meeting-runbook-2026-05-12` — ANT-side copy of this runbook (this file is the repo mirror)

**Research depth** (open if any specific technical conversation arises):
- [`docs/research/MCP_INTERFACE.md`](research/MCP_INTERFACE.md) — engineering-side companion to the deck (for Brian)
- [`docs/research/DCO_RECON.md`](research/DCO_RECON.md) — full schema introspection on `TimeScapeProcessManagement`
- [`docs/research/V1_5_TOOL_SURFACE.md`](research/V1_5_TOOL_SURFACE.md) — concrete tool signatures + return shapes
- [`docs/research/KEITH_NEEDS_TODAY.md`](research/KEITH_NEEDS_TODAY.md) — security/compliance non-negotiables

**Demo surfaces**:
- **[`docs/mockups/bk-meeting-presentation.html`](mockups/bk-meeting-presentation.html)** — single HTML file with all 12 slides + embedded DCO mockup + links grid (THE demo surface)
- [`docs/mockups/dco-savings-dashboard.html`](mockups/dco-savings-dashboard.html) — DCO savings dashboard mockup standalone
- **[`docs/demo_evidence/`](demo_evidence/)** — frozen dry-run captures (9/9 PASS). **Morning-of insurance**: re-run `docs/demo_dry_run.py` to refresh, and if live ODBC glitches during the meeting open the most recent capture in a side window and screen-share that — same narrative, screen-shareable. See `demo_evidence/README.md` for the one-line re-capture command.

**Operational**:
- [`docs/WINDOWS_NOTES.md`](WINDOWS_NOTES.md) — Windows-side gotchas (DLL search 3.8+, Python version pin, auth model)
- [`docs/deck/PUBLISH_PREP.md`](deck/PUBLISH_PREP.md) — antchat deck publish recipe (three James decisions still parked)

---

## Status (live)

- 2026-05-11: substrate shipped. v1.1.0-preview.2 tagged. All five v1.5 tools live. 44 tests pass. Deck + mockup + research docs + runbook + demo script + Q&A docs + presentation HTML all in main. Plan scoreboard via `ant task list`.
