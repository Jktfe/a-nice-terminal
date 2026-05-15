# Open questions for BK / Brian

Owner: cross-team
Security/compliance review: `@xenoCodex`
Purpose: one-page consolidated question list for the BK meeting, deduped from the deck, `DCO_RECON.md`, `MCP_INTERFACE.md`, `V1_5_TOOL_SURFACE.md`, and `KEITH_NEEDS_TODAY.md`.

## Highest priority: DCO Visibility

These answers determine whether the v1.5 tools can show real savings numbers or only counts, ratios, and placeholders.

| Priority | Question | Why it matters | Source docs |
| --- | --- | --- | --- |
| P0 | What baseline should DCO savings compare against: Bloomberg tier pricing, historical pre-DCO spend, a customer-provided contracted rate table, or another source? | Prevents invented or indefensible savings figures. | `DCO_RECON.md`, `V1_5_TOOL_SURFACE.md`, `KEITH_NEEDS_TODAY.md`, slide 12 |
| P0 | Where does the authoritative cost reference live today? | Determines whether v1.5 reads a DB table, config file, customer input, or remains structure-only. | `DCO_RECON.md`, `V1_5_TOOL_SURFACE.md` |
| P0 | What business dimension should savings be attributed to: desk, entity, business unit, cost centre, or another hierarchy? | Drives `dco_savings_by_desk` and the dashboard attribution view. | `DCO_RECON.md`, `V1_5_TOOL_SURFACE.md`, `KEITH_NEEDS_TODAY.md` |
| P1 | When a `RequestSubstitutes` row fires, is it always a clean savings event, or can it fall back through a path not visible in the current views? | Determines whether `dco_optimisation_decisions` can label a row as a successful substitution without caveats. | `DCO_RECON.md`, `V1_5_TOOL_SURFACE.md` |
| P1 | What demo data can we use: synthetic data, anonymised production extract, approved screenshots, or a live safe dataset? | The dev box schema is useful, but the DCO activity tables are empty. | `DCO_RECON.md`, deck slide 12 |

## Product and positioning

| Priority | Question | Why it matters |
| --- | --- | --- |
| P1 | Should DCO Visibility be positioned publicly, held for specific customer conversations, or used first as internal sales enablement? | Determines deck tone, release notes, and whether mockups can be prospect-facing. |
| P1 | Is xenoMCP a named product surface, a TimeScape EDM+ extension, or an internal enablement layer for demos and pilots? | Determines branding, packaging, and how far the deck can go. |
| P2 | Which initial pilot profiles are most useful: sell-side G-SIB, buy-side quant, vendor-cost-heavy client, or internal Xenomorph demo tenant? | Shapes the 60-day milestone and test data path. |
| P2 | Should the first DCO Visibility release be dashboard-only, MCP tools only, or both? | Aligns the visual artifact with engineering delivery. |

## Security, compliance, and governance

| Priority | Question | Why it matters |
| --- | --- | --- |
| P0 | Confirm the hard rule: all MCP and DCO Visibility outputs are customer-tenant scoped; no cross-client data, no Xenomorph internal data, no NMVC internal material. | Keeps every artifact aligned with `CONTRACT.md` Section 0. |
| P1 | Which compliance regimes matter most for the immediate audience: BCBS 239, FRTB, IPV/MCC, BaFin, DORA, T+1, or client-specific audit controls? | Lets us tune the deck and demo script to the controls BK / Brian care about. |
| P1 | Should the MCP audit log remain separate JSONL on the customer host, or should it integrate with an existing TimeScape audit trail? | Impacts production readiness and customer audit posture. |
| P2 | For customer demos, what level of identifier detail is acceptable in optimisation-decision examples? | Determines whether demo rows show real instrument identifiers, masked identifiers, or synthetic examples. |

## Engineering and roadmap

| Priority | Question | Why it matters |
| --- | --- | --- |
| P1 | What is the compatibility story for `timescape.pyd` across TimeScape minor versions and Python versions? | Determines packaging, support matrix, and upgrade guidance. |
| P1 | Is the CPython binding thread-safe, and what connection lifecycle does Xenomorph recommend for a long-running MCP process? | Impacts production hardening beyond the current stdio proof. |
| P1 | Are any of the current 16 v1 tools inappropriate to expose to an AI client even with confirm-gating? | Gives Brian a chance to veto surfaces that bypass downstream validation expectations. |
| P2 | Does Brian agree that v2/v3 should move toward capability-graph intents and cross-source federation, or should the AI lane stay strictly TimeScape-native? | Shapes the 90-day roadmap and deck close. |

## Suggested meeting flow

1. Start with the P0 DCO questions: baseline, cost reference, attribution dimension, and tenant boundary.
2. Move to demo data and positioning: what can be shown safely for BK / Keith / prospects.
3. Close with engineering: binding compatibility, audit integration, and any v1 tool-surface vetoes.

The goal is not to answer every roadmap question in one sitting. The goal is to unblock v1.5 DCO Visibility without weakening the trust model.
