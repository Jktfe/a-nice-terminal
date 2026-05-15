# The second product — Vendor Cost Management + DCO

Most conversations about Xenomorph centre on TimeScape EDM+. There's a second product that's been quietly generating measurable commercial value for clients, and it deserves a wider hearing.

## Two complementary modules

| Module | Purpose |
| --- | --- |
| **Vendor Cost Reporting** | Comprehensive analysis of Bloomberg Data License usage — by business line, by desk, by data type, by license category. Answers: *where is your Bloomberg spend going, and is it justified?* Identifies unused entitlements, redundant coverage, attribution by cost-per-instrument and cost-per-user. Structured output for vendor negotiation support. |
| **DCO — Data Cost Optimization** | *Automates* the cost reduction. Sits between the data retrieval layer and Bloomberg, and selects the cheapest viable license tier for each data request in real time (Per-Security ↔ EAP ↔ B-PIPE). Continuous, audited, zero downstream impact. The user gets the same data; the bill is materially smaller. |

## What DCO is actually doing

```
Trader requests data
        │
        ▼
   ┌────────────────────────────────────────────┐
   │  DCO routing layer                          │
   │  • Per-Security license available?          │
   │  • Cheaper EAP route covers this instrument │
   │  • Real-time vs. delayed — what's needed?   │
   │  • Historical depth on this request?        │
   └────────────────────────────────────────────┘
        │
        ▼
   Selects cheapest viable Bloomberg route
        │
        ▼
   Trader receives identical data
   Bloomberg invoice arrives materially smaller
```

Optimisations run **continuously**. Not a one-time cleanup that degrades as usage patterns evolve — an always-on routing layer that adapts.

## The gap (and the opportunity)

DCO + alternative-vendor routing save Xenomorph clients **many millions of dollars** annually in Bloomberg spend they would otherwise have paid. The data is there — DCO has to compute the optimisation to make the decision, so the delta between *what would have cost* and *what it cost* is computable per-decision.

**But Xenomorph doesn't surface the savings.**

Clients see the lower Bloomberg bill. They don't see a dashboard saying *"DCO saved you £X this quarter, here's the attribution by desk, here's how it compares to your industry peers."* The optimisation runs; the *story* doesn't.

That's a missed commercial moment. A buyer who renewed without seeing the savings number is a buyer who can't justify the platform to their CFO in five years' time when budgets tighten.

The xenoMCP roadmap addresses this directly in v1.5 — see slide 10.

> **Important boundary**: any DCO Visibility surface will show the calling customer's own savings only. No cross-customer benchmarking, no Xenomorph-internal P&L on the savings, no central data exhaust. Every figure will name its baseline and time window. This is binding (`docs/CONTRACT.md` §0) — the value-legibility lane never trades against tenant isolation.

<!--
Notes:
This is Keith Morris's point, surfaced via James. Keith said: "DCO saves clients many millions, but we rely on customers to figure out how much themselves." Treat that as the strategic gap this whole engagement is named at.

Don't say "Keith says…" — BK is on the same management team; he'll hear it as a peer-to-peer point rather than us name-dropping his CEO.

The ASCII diagram of DCO routing is illustrative — in final render upgrade to a proper visual.

Closing line ties this slide forward to slide 10 (DCO Visibility v1.5). The deck has a build: slide 7 sets up the gap, slide 10 closes it.

Pacing: ~75 seconds. Slow on the closing 4 lines.
-->
