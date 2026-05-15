# Questions for Brian Kristensen + Keith Morris — full reference

> **Audience:** internal tracker. For the **one-page hand-to-Brian summary**, see [`OPEN_QUESTIONS_FOR_BK.md`](OPEN_QUESTIONS_FOR_BK.md) (xenoCodex's P0/P1 priority cut — same source material, distilled).
>
> Every open question we have, consolidated from the four research docs and prioritised by what each one unblocks. Order is "answer these and we ship", not "answer these and we'll think about it".
>
> Sources: [`docs/research/DCO_RECON.md`](research/DCO_RECON.md) (4 schema-level Qs), [`docs/research/MCP_INTERFACE.md`](research/MCP_INTERFACE.md) (5 engineering Qs), [`docs/research/KEITH_NEEDS_TODAY.md`](research/KEITH_NEEDS_TODAY.md) (7 commercial/compliance Qs), [`docs/research/V1_5_TOOL_SURFACE.md`](research/V1_5_TOOL_SURFACE.md) (per-tool gating).

---

## How to read this

- **Status badges** show what answering each question unblocks: `[v1.5-blocker]` = the v1.5 release waits on this; `[v1.5-degrades]` = v1.5 ships without it but some tools return null fields; `[v2-input]` = we'd like the answer to inform v2; `[zero-cost]` = a sentence-long answer is sufficient.
- Sections are by **audience** (Brian / Keith / Joint). Skip sections that aren't yours.
- Every question is **stand-alone** — no need to read in order.

---

## A. Questions for Brian (engineering, product depth)

### A1. Per-request / per-record cost reference for Bloomberg Data License `[v1.5-blocker]`

**Context:** Our recon of `TimeScapeProcessManagement` found the activity log (`BloombergRequests`) and the substitution rules (`RequestSubstitutes`), but no pricing ref. Bloomberg DL has tier rates (per-security, per-field, per-call); without a numerator the savings story stays "we processed 12,847 requests" rather than "we saved $47,290".

**Ask:** Where does the per-request / per-record cost reference live? Three candidates:
1. A static config file in TimeScape we haven't found.
2. A separate database / table we missed (we covered tables matching `%DCO%`, `%Vendor%`, `%Cost%`, `%Licen%` in `TimeScapeProcessManagement` only).
3. Computed by clients externally from their own contract terms — i.e. NOT in TimeScape.

**What unblocks if answered:** `dco_savings_summary`, `dco_savings_by_desk`, `vendor_cost_summary` ship with non-null `estimated_savings.amount` rather than `null + unmet_dependencies`. The deck slide 10 demo can show real numbers, not placeholders.

### A2. "Desk" / org dimension semantics `[v1.5-degrades]`

**Context:** `EntityProcesses.EntityProcessID` looks like the right grouping for "desk", but TimeScape's data model is rich and there may be a higher-level concept (`Client`, `BusinessUnit`, `TradingBook`) better suited.

**Ask:** What's the canonical business dimension for attribution? Specifically: which view + column do we GROUP BY for "show savings by desk"?

**What unblocks:** `dco_savings_by_desk` ships with the right grouping label rather than `desk_dimension: "EntityProcessID"` + a `unmet_dependencies` flag.

### A3. Substitution success rate / "is this a reliable savings event?" `[v1.5-degrades]`

**Context:** When a `RequestSubstitutes` row fires, we currently treat `DataLoaded=1 AND matching RequestSubstitute row` as a confirmed savings event. We don't know if there's a fallback path that's not visible in the views (e.g. a sub fires but partially fails and Bloomberg gets called anyway, but we'd see only the success bit).

**Ask:** Is `(DataLoaded=1) AND (RequestSubstitute row exists for the same PackageRunID)` a reliable proxy for "this request was satisfied without hitting Bloomberg"? Or is there a more nuanced state machine?

**What unblocks:** `dco_optimisation_decisions` ships with definitive disposition labels rather than `disposition: "substituted_provisional"` flags. Cleaner narrative thread for the demo.

### A4. Demo / dev-data ergonomics `[v1.5-degrades]`

**Context:** The Xeno-issued laptop's `TimeScapeProcessManagement` DCO tables are empty (0 rows except `ActiveRequestVendors=2`). Sufficient for schema design and stub responses; insufficient for a live demo where BK sees actual numbers.

**Ask:** Three options, in increasing order of impact:
1. Synthetic dataset we generate ourselves. Fastest. We label clearly as synthetic in the UI (no risk of being mistaken for real client data).
2. Anonymised extract from a real reference customer (with their permission). Best signal, requires customer relationship + an anonymisation pipeline.
3. Approved screenshots / figures from a reference deployment.

Which can Xeno enable, on what timeline?

**What unblocks:** the demo's "live numbers vs static slide" axis. Without this, the BK demo runs against synthetic-but-honest data; with this, against real-but-anonymised.

### A5. TimeScape version cadence + CPython binding ABI `[v2-input]`

**Context:** The .pyd we ship against is `v3.13/64-Bit` from the v5.0 install. Per-Python-version `.pyd` files are documented in the install. What's the binding's compatibility story across TimeScape minor versions (e.g. v5.0 → v5.1)?

**Ask:** Does the .pyd shape change across TimeScape minor releases? If so, do we need to ship multiple `.pyd` shadows, or is forward compat the contract?

**What unblocks:** the customer-install story for the MCP. If forward compat is the norm, one MCP install per Python-major suffices.

### A6. Audit-log integration `[v2-input]`

**Context:** The MCP writes its own JSONL audit (per-tool dispatch + outcome + confirm status). Customer hosts may already have a TimeScape audit trail (DB-level CDC, EDM+ logging, etc.).

**Ask:** Does TimeScape have an existing audit trail we should join into / forward to, rather than running a parallel one?

**What unblocks:** v2 audit consolidation. Currently a customer with strict audit needs has to look in two places.

### A7. Connection / threading model for long-running MCP `[v2-input]`

**Context:** A long-running MCP server fields many tool calls over its session. The `.pyd` uses some implicit connection management to SQL Server.

**Ask:** What's the right pooling / connection-lifecycle posture? Is `timescape.pyd` thread-safe, or do we need to serialise tool calls?

**What unblocks:** v2 performance characteristics. Today (single user driving Claude Desktop) the question is academic; in v2 it isn't.

### A8. Tools we shouldn't expose even with confirm-gating `[v2-input]`

**Context:** We currently gate writes / destructive ops uniformly. There may be specific calls (e.g. a `saveProp` that bypasses an EDM+ validation pipeline) that have downstream consequences best handled outside the MCP.

**Ask:** Is there anything in our 16 we should explicitly exclude from the AI-callable surface?

**What unblocks:** v1.5 / v2 tool-list curation. Better to remove a tool than to discover later it has a side-effect we didn't model.

### A9. v3 federation thesis `[v2-input]`

**Context:** Xeno's positioning has long emphasised the "single point of access to all your data" thesis. The MCP could extend that from human-facing Workbench to AI-facing.

**Ask:** Does it sit well to extend that thesis to the AI lane? Or is there a reason the AI surface should stay strictly TimeScape-native?

**What unblocks:** v3 design intent. Affects whether v3 wraps non-TimeScape sources too (BBG DL direct, RDP, ICE, customer flat files) or stays narrow.

---

## B. Questions for Keith (commercial, positioning, compliance)

### B1. DCO savings — customer-facing or internal sales enablement? `[v1.5-input]`

**Context:** The DCO Visibility surface can be positioned two ways: (a) as a customer-facing dashboard ("here's what you've saved this month"), or (b) as Xeno-internal sales enablement ("here's a number our salespeople use to win net-new customers").

**Ask:** Which framing — or both, with different scoping?

**What unblocks:** how aggressively we surface savings in the demo. (a) means tools speak in customer voice; (b) means we package the same data as case-study material.

### B2. v1.5 release scope — read-only dashboards or exportable evidence packs? `[v1.5-input]`

**Context:** `dco_optimisation_decisions` returns per-request decision detail. Customers might want to export that for their procurement / audit teams as durable evidence ("we saved $X, here's the journal entry-style log").

**Ask:** Should v1.5 ship with an export tool (`dco_export_evidence_pack(window) → .csv / .pdf`)? Or is read-only sufficient until customers ask?

**What unblocks:** scope for v1.5. Currently sized at 5 read-only tools; +1 export tool is a half-day of additional work.

### B3. Compliance regimes that matter most for the immediate audience `[v1.5-input]`

**Context:** Different regulators frame data-quality / data-cost / audit requirements differently. The demo lands harder if it explicitly maps to the regimes BK's audience cares about.

**Ask:** Which of these matter most for the BK meeting and the immediate customer pipeline?

- **BCBS 239** (risk data aggregation principles)
- **FRTB** (Fundamental Review of the Trading Book)
- **IPV / MCC** (Independent Price Verification / Marker-Curves-Curves)
- **BaFin** (German prudential)
- **DORA** (Digital Operational Resilience Act, EU)
- **T+1** (US settlement cycle change)
- **Client-specific audit controls** (whatever a particular target customer specifically requires)

**What unblocks:** which compliance hooks we lean into in the demo + slide 6 (Compliance lane).

### B4. Approved examples / anonymised outputs for BK deck + DCO mockup `[v1.5-input]`

**Context:** Mirrors A4 from the Brian column, but framed for Keith: who decides whether a customer's data can appear in the deck (anonymised)?

**Ask:** Is there a customer relationship at the right level of trust to source anonymised real numbers from? Or do we firmly stay synthetic-only for now?

**What unblocks:** real-numbers vs synthetic-numbers in the deck. Currently planning synthetic; real changes the credibility curve.

---

## C. Joint questions (need both perspectives)

### C1. The pricing-baseline conversation `[v1.5-blocker]`

**Context:** A1 (where the cost reference lives — engineering) and the commercial framing of the savings story (Keith's lane) are the same question seen from two sides. If the cost reference is in a static config that customers maintain, that's a customer-onboarding step; if it's computed externally, that's a salesperson-led conversation; if it's in TimeScape but we missed it, that's a 30-min Brian conversation.

**Ask:** Whichever side resolves it, treat the answer as a joint deliverable that covers (a) where the data lives, (b) which party owns it, (c) what the demo can use today.

**What unblocks:** four of the five v1.5 tools, the deck slide 10 numerics, the BK-meeting close.

### C2. The "what counts as a saving" semantic `[v1.5-input]`

**Context:** A3 (substitution success rate, engineering) shades into a definitional question: is a "saving" measured at the request level, the session level, the per-record level, or per-day-end? Different definitions produce different numbers from the same activity log.

**Ask:** What definition does Xeno want to standardise on for the customer-facing v1.5 release?

**What unblocks:** the headline number. Avoids the situation where our number disagrees with another Xeno team's number computed differently.

---

## D. Quick wins (≤1-sentence answers welcome)

### D1. Default user-population for v1.5

**Ask:** Quant analyst seat? Operations / data engineer? Compliance / IPV team? CFO-office? Just say which one is the primary persona for v1.5 and we'll skin the demo to them.

### D2. Naming convention for tool functions

**Ask:** Snake_case (`dco_savings_summary`) per current docs, or camelCase (`dcoSavingsSummary`) per the v1 conventions in `server.py`? Mixed today; quick standardise.

### D3. Repo visibility post-meeting

**Ask:** xenoMCP is currently private under `Jktfe`. Post-BK, does it stay private (Xeno-internal contractor work), get transferred to a Xeno org, or open-source? Affects how forward-looking docs (v2/v3 roadmap) are phrased.

---

## Recommended order of conversation

For a 30-minute Brian + Keith call, in priority order:

1. **C1** (5 min) — pricing baseline. Unblocks the most tools.
2. **A2** (3 min) — desk dimension. Unblocks `dco_savings_by_desk`.
3. **A3** (5 min) — substitution semantics. Unblocks `dco_optimisation_decisions`.
4. **A4 + B4** (5 min) — demo data path. Determines whether the BK meeting itself can show real numbers.
5. **B1** (5 min) — customer-facing vs internal positioning. Unblocks the deck framing.
6. **D1** (1 min) — primary persona. Last-pass tightening.

Remaining questions (A5–A9, B2, B3, C2, D2, D3) can answer async by email — they shape v2 / v3 / packaging, not v1.5.

---

## Status snapshot (so Brian knows what's already in flight)

- v1.0.0 tagged + released: <https://github.com/Jktfe/xenoMCP/releases/tag/v1.0.0> — baseline 16 tools
- v1.1.0-preview tagged: <https://github.com/Jktfe/xenoMCP/releases/tag/v1.1.0-preview> — first v1.5 tool live
- **v1.1.0-preview.2 tagged: <https://github.com/Jktfe/xenoMCP/releases/tag/v1.1.0-preview.2> — all five v1.5 tools live**
- 21 tools live (16 baseline + 5 v1.5 DCO Visibility), end-to-end stdio handshake verified, BP.L round-trip in <100ms
- Maker-Checker (four-eyes) enforced uniformly across the 12 gated tools
- v1.5 surface contracted in `docs/research/V1_5_TOOL_SURFACE.md`; **all five tools shipped** — 2 return real data immediately (`vendor_entitlement_audit`, `dco_optimisation_decisions`), 3 return structure-only (`dco_savings_summary`, `dco_savings_by_desk`, `vendor_cost_summary`) with `unmet_dependencies: ["baselineMethod"]` until cost-baseline question lands
- 44 cross-platform tests passing
- Full deck (12 slides) in `docs/deck/`, demo script in `docs/DEMO_SCRIPT.md`, 4 analyst-workflow examples in `docs/examples/`

This isn't the conversation about whether to build the MCP. It's the conversation about **what numbers go on slide 10** when we ship next week.
