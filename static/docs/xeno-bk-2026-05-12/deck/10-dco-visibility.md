# The DCO Visibility extension (v1.5)

Slide 7 named the gap: DCO saves Xenomorph clients millions of dollars in Bloomberg spend, but you don't surface the savings. This slide proposes the fix.

## What the recon found

The recon (`docs/research/DCO_RECON.md` in the repo) confirms DCO state isn't on the public programmer surface — it lives in the `TimeScapeProcessManagement` SQL Server database. **The schema is rich enough to support a v1.5 tool surface without any platform changes.**

| Source | What's in it |
| --- | --- |
| `BloombergRequests` (view, 18 cols) | Every outbound Bloomberg API call as one row. `ExecID`, `RequestType`, `AssetClass`, `TimeStamp`, plus bit-flags for `DataLoaded` / `RequestError` / etc. — i.e. *did this DCO request succeed*. **The savings-event log.** |
| `RequestSubstitutes` (view, 12 cols) | Alternative-vendor substitution rules. When a Bloomberg request can be served from a different DataSource — fundamentally what "saving" means in DCO terms. **The savings-rule map.** |
| `EntityProcesses` join chain | Workflow/entity model — joinable to `BloombergRequests` for desk-level attribution. |
| `ActiveRequestVendors`, `ActiveEntityRequestVendorConfigs/Parameters` | Vendor entitlement model — which vendors a client is paying for, at what granularity. |

## Proposed v1.5 tool surface

| Tool | What it returns | Data source | Status |
| --- | --- | --- | --- |
| **`vendor_entitlement_audit()`** | Unused / redundant Bloomberg entitlements ("paying but not consuming"). | `ActiveRequestVendors` + `ActiveEntityRequestVendorConfigs/Parameters` | **✅ live, real data** (`v1.1.0-preview`) — zero open-Q dependencies |
| **`dco_optimisation_decisions(period, instrument?)`** | Per-decision detail: requested-tier → served-tier → £ delta. Classifies disposition (`dco_served`/`substituted`/`failed`). | `BloombergRequests` LEFT JOIN `RequestSubstitutes` LEFT JOIN `BloombergRequestIdentifiers` | **✅ live, real data** (`v1.1.0-preview.2`) — zero open-Q dependencies |
| **`dco_savings_summary(period, scope?)`** | Total £ saved by DCO vs unoptimised baseline over window. | `BloombergRequests` aggregate × cost reference | **✅ live, structure-only** (`v1.1.0-preview.2`) — counts/ratios/vendor-mix return today; `amount: null` + `unmet_dependencies: ["baselineMethod"]` until Q1 |
| **`dco_savings_by_desk(period)`** | Attribution split by business line / desk. | `EntityProcesses` → `EntityRequestMessages` → `BloombergRequests` | **✅ live, structure-only** (`v1.1.0-preview.2`) — desk grouping returns today; values flip when Q2 settles |
| **`vendor_cost_summary(vendor, period)`** | Spend by vendor across all consumers. | Request counts × cost reference | **✅ live, structure-only** (`v1.1.0-preview.2`) — vendor-mix returns today; cost figures flip when Q1 settles |

All five are **read-only**. All five are **tenant-isolated by construction** (CONTRACT §0) — the AD service account inheriting the customer's identity can only see the customer's `TimeScapeProcessManagement` instance. No cross-customer aggregates. No Xenomorph-internal P&L on the savings.

**Baseline discipline** (the harder commitment): a saved-£ number is only useful if the baseline it compares against is named and defensible. Every tool output will explicitly identify (a) the time window, (b) the cost reference used, (c) the optimisation comparison — *"DCO routed via EAP instead of Per-Security"* not *"saved £X"*. Vague savings figures are a contract violation by design.

**No exportable Xenomorph-aggregate views.** Even with explicit customer permission, peer-comparison / industry-benchmark tooling stays out of v1.5 until a data-governance model exists for that pattern. *Customer's own data, to the customer's own users, on the customer's own host.*

## What's gated — four questions for Brian

The technical readiness is high. What's missing is product calls on the savings narrative:

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | **Cost reference**: where does per-request / per-record Bloomberg cost data live? Static config, a separate DB we haven't found, or computed externally by clients from their own tier agreements? | Without this, the "$ saved" headline is unanchored. With it, every `BloombergRequests` row becomes a numbered savings event. |
| 2 | **"Desk" semantics**: is `EntityProcesses.EntityProcessID` the right grouping for what business calls "desk", or is there a higher-level concept (Client / BusinessUnit / Trading Book) elsewhere in the schema? | Determines the granularity of `dco_savings_by_desk`. |
| 3 | **Substitution success rate**: when a `RequestSubstitutes` rule engages, does it always succeed, or is there a fallback path that's not visible in the views? Is `DataLoaded=1 AND matching RequestSubstitute row` a reliable "savings event"? | Determines whether savings can be claimed at request granularity or only at session granularity. |
| 4 | **Demo data gap**: the dev laptop's `TimeScapeProcessManagement` has zero rows. Do real deployments populate it daily? Could we anonymise a snapshot from a real client (with permission) to power a live demo? | Determines whether the v1.5 reveal is a static mockup or a working dashboard. |

These aren't blockers. They're a 30-minute conversation. Once they're settled, **the structure-only tools start returning real numbers — no new code, no new exploration, no new shipping**. The shape is already in production; we're just filling in the values your customers can see.

<!--
Notes:
This is the most important slide of the deck for the commercial argument. Slide 7 set up the gap (Keith's point); slide 10 closes it with concrete tools + concrete schema + concrete questions.

The "four questions for Brian" is doing two jobs at once: (a) making it clear we've done real work and have informed questions, not vague speculation; (b) giving BK something to engage with as a peer rather than just receive.

The "30-minute conversation" line at the end is the disarming move — it explicitly frames the gap as small and easily closed, not as an existential blocker.

Bring up the DCO_RECON.md doc on screen if there's a laptop in the room. The depth of the schema introspection sells the credibility better than any slide can.

Pacing: ~120 seconds. This slide gets the longest dwell. Linger especially on the Confidence column — that's where the work shows.
-->
