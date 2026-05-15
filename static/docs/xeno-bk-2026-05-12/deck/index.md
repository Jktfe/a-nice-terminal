# xeno-bk-pitch — deck manifest

**Slug**: `xeno-bk-pitch`
**Audience**: Brian Kristensen (Xenomorph CTO / co-founder) — and by extension anyone at Xenomorph or NMVC who picks this up.
**Brief**: open-slide deck explaining what Xenomorph is and what it does, framed against the modern presentation / AI-surface we're building atop. **Hard rail**: we never modify Xenomorph's code — only build atop it. The deck celebrates their 30 years of engineering and proposes the wrap.

**Narrative thread** (xenoCC, 2026-05-11): *"BK sees the engineering daily — what he's never seen is what their tech feels like with modern presentation on top. Lean into the contrast."*

## Slide order

| # | Slide | File | Status |
| --- | --- | --- | --- |
| 01 | Cover — your platform, brought to the AI surface | `01-cover.md` | draft |
| 02 | The proposition — what we're proposing in one paragraph | `02-proposition.md` | draft |
| 03 | What you've built — 30 years of TimeScape engineering | `03-what-youve-built.md` | draft |
| 04 | The architecture — Raw → Silver → Gold tiered Gold Copy | `04-architecture.md` | draft |
| 05 | The customers — verified deployments at G-SIBs and asset managers | `05-customers.md` | stub |
| 06 | The compliance lane — BCBS 239 / FRTB / IPV-MCC / BaFin / DORA / T+1 | `06-compliance.md` | stub |
| 07 | The second product — Vendor Cost Management + DCO | `07-vendor-cost.md` | stub |
| 08 | The market right now — the EDM + AI wave | `08-market.md` | stub |
| 09 | What we built atop, this week — xenoMCP v1.1.0-preview.2 | `09-what-we-built.md` | draft |
| 10 | The DCO Visibility extension (v1.5) — surface the savings | `10-dco-visibility.md` | stub |
| 11 | The AI-fluent surface thesis — extending Matt Pick's data-trust line | `11-ai-thesis.md` | stub |
| 12 | The path forward — deliverable today, 30 days, 90 days | `12-path-forward.md` | stub |

## Format conventions

- **Markdown per slide.** One H1 per slide as the title. Body uses H2 for sub-sections.
- **Speaker notes**: in HTML comments at the bottom of each slide — `<!-- Notes: ... -->`. Renderer-agnostic; the Open-Slide renderer treats these as presenter-mode notes.
- **Visual identity**: aligned with `/Users/jamesking/CascadeProjects/XenomorphDesignSystem/tokens.css` — light, blue/navy, Inter / JetBrains Mono. Final render target may be HTML/PDF for sharing; Markdown source is canonical.
- **No NMVC-internal data.** §0 Tenancy isolation applies — see `docs/CONTRACT.md`. Numbers in this deck are public-sourced or framed as ranges, never the privately-held figures.

## Cross-review

- Drafted by `@xenobridgeclaude` (Mac mini).
- Cross-review at 50% mark by `@xenoCC` and `@xenoCodex` per the agreed cadence.
- Published to the antchat room via `antchat deck <room> file put xeno-bk-pitch ...` once the first cut is complete.

## Status (live)

- 2026-05-11: deck scaffolded with manifest + 4 draft slides + 8 stubs.
