# How we meet Keith's needs today

Owner: `@xenoCodex`
Role: security and compliance seniority across the Xenomorph deck, MCP interface doc, and Keith-needs research lane.
Status: first cut for cross-review.
Date: 2026-05-11

## Executive view

Keith's immediate need is not another proof that Xenomorph's core technology works. The TimeScape platform already does that. The need is to make the existing strength legible to modern buyers, AI-native workflows, and internal stakeholders without weakening the security, tenant-isolation, or trust posture that makes the platform valuable in the first place.

The current work meets that need in three linked artifacts:

| Artifact | Owner | What it proves |
| --- | --- | --- |
| BK deck | `@xenobridgeclaude` | Xenomorph has deep, proven financial-data infrastructure and can be presented with a modern, AI-fluent surface. |
| MCP / agent-interface research | `@xenoCC` | The live TimeScape CPython binding can be exposed to AI clients through a safe, auditable MCP layer without changing Xenomorph code. |
| Keith-needs research | `@xenoCodex` | The commercial story can be sharpened around DCO savings and AI readiness while staying inside customer-only data, tenant isolation, and compliance boundaries. |

The key commercial gap is DCO value visibility. Xenomorph's DCO and alternative-vendor routing can reduce clients' data-vendor spend, but the value is not surfaced in a way a customer can carry to a CFO, procurement committee, or board. The MCP lane is the right vehicle to expose that value, as long as every figure is scoped to the calling customer and every baseline is defensible.

## What Keith likely needs today

1. A credible near-term story for Brian / BK: this is not a speculative AI wrapper. It is a working MCP over the live TimeScape binding, tagged `v1.1.0-preview.2` (16 baseline tools + 5 v1.5 DCO Visibility tools, 21 total), with a read/write safety contract and a verified `BP.L` round trip.

2. A clearer customer-value story: DCO should move from quietly saving money to showing the savings summary, attribution, decision trail, and evidence the customer can use internally.

3. A trust-preserving AI story: Xenomorph can enter the AI workflow without becoming an uncontrolled data broker. The model should query through customer-hosted, AD-scoped, audit-friendly interfaces, not through a central cross-client Xenomorph service.

4. A set of deliverables that can be shown now: deck, research docs, v1 MCP release notes, DCO recon findings, and a safe v1.5 tool surface — with all five tools live (2 real-data, 3 structure-only pending the baseline answer).

5. A short list of unresolved business questions for Keith / Brian: baseline pricing, desk attribution, substitution-success semantics, demo-data availability, and how public the DCO savings story should become.

## Security and compliance non-negotiables

These rules should govern the deck, the MCP docs, and any DCO Visibility implementation.

| Rule | Practical implication |
| --- | --- |
| Customer data only | The MCP must serve the calling customer's own TimeScape data. No internal Xenomorph data, no NMVC data, no other-client data, no cross-tenant aggregates. |
| Tenant-scoped deployment | The MCP runs on the customer's TimeScape host under the customer's Windows/AD identity. Integrated Security is the isolation boundary. |
| No central data exhaust | Audit logs stay on the customer host. Do not centralise tool-call payloads or customer query values at Xenomorph. |
| No internal-intel tools | Tools such as customer lists, market share, internal pipeline, or competitive-intel summaries are out of scope by design. |
| Safe DCO visibility | DCO tools may show a customer's own savings and decisions. They must not compare one customer against another unless explicit, customer-approved benchmarking exists. |
| Baseline discipline | A savings number is only useful if its baseline is named and defensible. No vague millions-saved tool output without source, time window, and pricing assumptions. |
| Read/write separation | Read tools can be open. Write, destructive, config, and batch actions must stay confirm-gated; destructive actions need the four-eyes roadmap before sensitive deployment. |

## What we can safely show now

The current artifacts can safely demonstrate the following:

- Xenomorph's existing technology can be accessed by AI clients through the public CPython binding, without modifying Xenomorph's code.
- The MCP is customer-hosted and stdio-based, so it does not add a new inbound network service.
- The `CONTRACT.md` tenancy rule explicitly blocks cross-tenant, Xenomorph-internal, and other-client data exposure.
- The DCO recon found where the operational state lives: `TimeScapeProcessManagement`, especially `BloombergRequests` and `RequestSubstitutes`.
- The v1.5 DCO Visibility surface is live as of `v1.1.0-preview.2` — a read-only layer over existing SQL views. Two tools return real data today; three return structure-only with `unmet_dependencies: ["baselineMethod"]` until the pricing and semantics conversations land. The shape doesn't change when answers arrive — only the figures fill in.
- The dev machine currently lacks live DCO activity rows, so a polished demo needs synthetic data, an anonymised extract, or approved screenshots.

## What we should not show or imply

- Do not show any real client DCO savings without explicit permission and a documented basis.
- Do not imply Xenomorph has cross-client benchmarking unless the data governance model exists.
- Do not put NMVC internal commercial views, debt/refinancing context, investment thesis, or private diligence material into the deck or ANT docs.
- Do not position the MCP as a replacement for TimeScape security. It inherits TimeScape and Windows controls; it does not supersede them.
- Do not promise automatic dollar savings until the baseline pricing model is confirmed.
- Do not use the dev box's empty DCO tables as proof of absence or low usage. They are sufficient for schema recon, not for value measurement.

## DCO Visibility: safe near-term shape

Keith's needs are served by the v1.5 DCO Visibility layer shipped in `v1.1.0-preview.2` — read-only and explanatory:

| Proposed capability | Purpose | Compliance stance |
| --- | --- | --- |
| `dco_savings_summary` | Customer's own savings over a period, with named baseline. | Tenant-scoped, no peer comparison. Requires cost reference. |
| `dco_savings_by_desk` | Attribution by desk/business unit if the entity dimension is confirmed. | Only customer-owned org dimensions. No cross-customer rollups. |
| `dco_optimisation_decisions` | Per-request decision trail: DCO-served, substituted, direct-to-Bloomberg, failed. | Strong audit story; avoid sensitive payload values unless necessary. |
| `vendor_entitlement_audit` | Show active vendor/program/account configuration and potential redundancy. | Configuration metadata only; still customer-owned. |
| `vendor_cost_summary` | Spend by vendor over a period. | Requires pricing source and careful treatment of contract terms. |

This should be positioned as value made legible, not as new optimisation logic. The optimisation already exists. The missing layer is evidence, attribution, and a safe user-facing surface.

## Compliance review checklist for the team

Use this checklist before publishing deck slides, docs, or MCP changes:

1. Does every data claim identify whether it is public, synthetic, customer-owned, or internal?
2. Does any example imply access to other clients' data?
3. Does any DCO savings figure name the baseline, period, and cost source?
4. Are internal Xenomorph/NMVC commercial details excluded?
5. Does the artifact preserve the rule: build atop Xenomorph, never modify Xenomorph code?
6. Are write/destructive MCP paths described as confirm-gated, with four-eyes planned for destructive operations?
7. Does the artifact avoid saying AI can do anything in TimeScape and instead describe the actual MCP tool surface?
8. If demo data is used, is it clearly synthetic, anonymised with permission, or customer-owned in the calling tenant?

## Open questions for Keith / Brian

1. What baseline should DCO savings compare against: raw Bloomberg Data License per-security pricing, historical pre-DCO spend, a contracted client price table, or another reference?
2. Where does the authoritative cost reference live today?
3. What business dimension should be used for attribution: desk, entity, business unit, cost centre, or something else?
4. Are there approved examples or anonymised outputs that can be used in the BK deck and DCO mockup?
5. How much of the DCO savings story should be customer-facing versus internal sales enablement?
6. Should the first DCO Visibility release be read-only dashboards only, or should it include exportable procurement/audit evidence packs?
7. Which compliance regimes matter most for the immediate audience: BCBS 239, FRTB, IPV/MCC, BaFin, DORA, T+1, or client-specific audit controls?

## Recommended next deliverable

For the BK meeting, the highest-value safe deliverable is a DCO Visibility mockup backed by clearly labelled synthetic data:

- one executive savings summary;
- one attribution view by desk/business unit;
- one optimisation-decision trail showing why a request avoided a more expensive vendor path;
- one security callout: customer-hosted, AD-scoped, no cross-tenant data;
- one open-question panel naming the pricing baseline still needed from Keith / Brian.

That gives Keith a concrete story without creating a data-governance breach: Xenomorph's engine already creates the value; the AI/MCP layer makes it inspectable, explainable, and board-ready.

## Current status

- MCP `v1.1.0-preview.2` is shipped and live-verified; all five v1.5 DCO Visibility tools live (2 real-data, 3 structure-only); 44 of 44 cross-platform tests passing.
- DCO schema recon is complete enough for tool design.
- Cost reference, desk semantics, substitution-success semantics, and demo data remain open.
- This doc should feed slide 7 (Vendor Cost + DCO), slide 10 (DCO Visibility), slide 11 (AI-fluent surface), and the MCP interface doc's safety sections.
