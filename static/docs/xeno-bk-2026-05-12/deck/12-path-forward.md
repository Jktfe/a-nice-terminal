# The path forward

What's deliverable today. What's deliverable in 30 days. What's deliverable in 90 days. All built atop the platform, none requiring changes to it.

## Delivered today (2026-05-11)

| | Status |
| --- | --- |
| **xenoMCP v1.0.0** tagged + released | https://github.com/Jktfe/xenoMCP/releases/tag/v1.0.0 |
| 16 tools end-to-end verified against TimeScape v5.0 | `BP.L = 508.0` round-trip confirmed |
| **xenoMCP `v1.1.0-preview.2` tagged** — ALL FIVE v1.5 tools live | 2 return real data (`vendor_entitlement_audit`, `dco_optimisation_decisions`); 3 return structure-only with `unmet_dependencies: ["baselineMethod"]` until Brian answers the cost-reference question. **21 tools total** |
| Safety contract — §0 Tenancy isolation pinned + Appendix B pre-publish checklist | `docs/CONTRACT.md` |
| Cross-platform test suite — **44 passing** | Mac + Windows + Linux dev mirrors |
| **DCO Visibility v1.5 recon complete** | `docs/research/DCO_RECON.md` — full schema introspection on `TimeScapeProcessManagement` |
| **v1.5 tool surface contract** | `docs/research/V1_5_TOOL_SURFACE.md` — signatures + return shapes |
| This deck | `docs/deck/` — open-slide, contributable |
| Windows operational notes | `docs/WINDOWS_NOTES.md` |
| BK prep — full Q&A tracker + one-pager + anticipated-questions FAQ | `docs/BK_QUESTIONS_FULL.md`, `docs/OPEN_QUESTIONS_FOR_BK.md`, `docs/BK_FAQ.md` |
| 7-minute live demo plan | `docs/DEMO_SCRIPT.md` |

You can install + run xenoMCP today. The MCP transport is stdio; any Claude Desktop / Claude Code / Cursor / future AI client can consume it.

## 30 days — DCO Visibility v1.5

**All five v1.5 tools shipped in this session.** What the 30-day window is now waiting on isn't tool development — it's the cost-baseline conversation:

- ~~`dco_savings_summary`~~ — **shipped 2026-05-11**, structure-only (counts/ratios/vendor-mix today; £ amount flips from `null` to real when baseline lands)
- ~~`dco_savings_by_desk`~~ — **shipped 2026-05-11**, structure-only (desk grouping today; values flip when desk semantics confirmed)
- ~~`dco_optimisation_decisions`~~ — **shipped 2026-05-11**, returns real data today
- ~~`vendor_entitlement_audit`~~ — **shipped 2026-05-11**, returns real data today
- ~~`vendor_cost_summary`~~ — **shipped 2026-05-11**, structure-only (vendor-mix today; cost figures flip when baseline lands)

All read-only, all tenant-isolated, all backed by the `TimeScapeProcessManagement` views identified in the recon. The 30-day milestone shifts from "build v1.5" to "settle the cost-baseline question and watch three of the five tools start returning real numbers" — the toolchain is already in place. A CFO conversation with Claude is *"how much did DCO save us last quarter, by desk?"* — the question Claude can already answer with structure today, and with numbers the day after the meeting.

Parallel deliverable: a **DCO savings dashboard** mockup using XenomorphDesignSystem tokens. The kind of visual artefact a CFO can take to their board to defend the platform spend.

## 60 days — Production readiness

- **Four-eyes (Maker-Checker) refusal layer** on destructive tools — the v1.1 item already scoped in `docs/CONTRACT.md` §5. Brings the MCP into BCBS 239-grade audit alignment.
- **Audit log JSONL persistence** — server-side, customer-host-local (never centralised at Xenomorph per §0).
- **Sample MCP-client deployments** with two pilot clients (selection collaborative — would suggest one G-SIB sell-side + one buy-side quant).

## 90 days — The AI lane proper

- **Natural-language QL+ generation** — Claude composes QL+ from English questions, calls `query` or `itemQuery` with structured args. Demonstrable to prospects as the AI-fluent surface.
- **Validation rule editing via natural language** — "Add a tolerance check for BP equity close prices > 1000 between 2024 and 2026" → MCP generates the rule definition, Maker-Checker approves, deploys.
- **Lineage queries** — "What sources fed the closing price reported to risk yesterday?" → MCP traces the lineage chain and returns it.
- **Customer-facing deck variant** — same narrative, no internal positioning, suitable for prospect meetings.

## Open questions to settle in the meeting

1. **Cost reference data for DCO savings figures** — slide 10, Q1.
2. **"Desk" / org-dimension semantics** in `EntityProcesses` — slide 10, Q2.
3. **Substitution success rate** confirmation — slide 10, Q3.
4. **Demo data approach** — synthetic, anonymised production extract, or live screenshots — slide 10, Q4.
5. **Pilot client selection** for 60-day milestone.
6. **MCP positioning under the Xenomorph brand** — separate product line vs. extension of TimeScape EDM+ — and how that aligns with Mark's design files at the URL James shared.

## What we're asking for

Nothing today. The work has already happened. What we'd find useful from this conversation: alignment on the 30/60/90 milestones, the **cost-baseline question answered** (15-30 minutes of your time on Q1 from slide 10) so three already-shipped tools can light up with real numbers, **desk-dimension semantics confirmed** (Q2) so attribution lands cleanly, and an indication of whether Xenomorph wants to position v1.1.0 publicly when those values flip or hold it for client conversations first.

Thirty years of engineering. A modern AI-fluent surface. Built atop, never inside. **The platform is yours. The wrap is delivered.** What's left isn't engineering — it's the conversation that turns null fields into your customers' savings stories.

<!--
Notes:
This is the close. Three jobs: (a) recap the surface area of delivered work; (b) show concrete 30/60/90 milestones so it doesn't feel like vapour; (c) name what we're asking for cleanly so the meeting has a productive next-step.

The "what we're asking for" line — "nothing today, the work happens regardless" — is important. It removes pressure and signals confidence. The actual asks (alignment + 30 min on the four questions + positioning preference) are small.

The closing line — "The platform is yours. The wrap is ours to deliver." — bookends the deck. Slide 1 opened with "Your platform. Brought to the AI surface." Slide 12 closes with the same frame, now grounded in twelve slides of substantive work.

Pacing: ~120 seconds. End at a natural pause; let the room move into Q&A.
-->
