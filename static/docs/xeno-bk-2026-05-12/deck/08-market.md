# The market right now

The EDM space hasn't been still in 2025-2026. Three forces are reshaping the conversation simultaneously, and Xenomorph is well-positioned for all three — but the positioning isn't yet visible to the market.

## Force 1 — The AI / MCP wave is no longer hypothetical

| Vendor | Move | When |
| --- | --- | --- |
| **KX (kdb+)** | Shipped **KDB-X** with a built-in MCP server for AI-assisted querying. Merged with OneMarketData / OneTick. | Spring 2026 |
| **GoldenSource** | v8.8 ships an LLM chatbot for navigation + AI-driven data scrubbing. Moving to "EDM-as-a-Service". | 2025 |
| **Bloomberg** | Bloomberg GPT — 50B-parameter finance-tuned model that generates BQL. | 2023, extended 2025 |
| **Snowflake** | Cortex / Copilot — NL→SQL generally available via API. | 2024, GA 2025 |

**MCP is becoming table stakes in this stack.** Buyers in 2026 will start asking "does your platform have an MCP surface?" the way they asked "does it have a REST API?" in 2018.

## Force 2 — Cloud-native disruption

| Disruptor | Position |
| --- | --- |
| **FINBOURNE LUSID / EDM+** | Cloud-native, API-first, won Buy-Side Tech 2025. Recent wins: Fidelity International, Baillie Gifford, Pension Insurance Corp. **Uses the same "EDM+" naming as Xenomorph** — a naming clash that needs addressing. |
| **Snowflake + Crux Informatics** | Vendor data lands directly in client Snowflake. Attacks the ingest/normalise layer underneath EDM. |
| **ArcticDB (Man Group, open-source)** | S3-native time-series, no MongoDB dependency. Lower-stack but reshapes what's expected. |

## Force 3 — Regulatory tailwinds (slide 6 recap)

ECB RDARR (SSM 2025-27 priority), DORA live Jan 2025, T+1 settlement (US live, EU + UK on schedule). All push the EDM TAM upward. All play directly to Xenomorph's 30-year compliance heritage.

## Where this lands

| Force | Xenomorph's natural position |
| --- | --- |
| AI / MCP | Has the right thesis (Matt Pick's "AI is only as good as the underlying data"). **Missing the surface that makes the thesis demonstrable to buyers.** ← This is what xenoMCP fills. |
| Cloud-native disruption | Has Azure deployment proven at Mizuho Americas. Heritage + cloud-readiness is a credible counter to *pure*-cloud-native vendors who lack the regulatory pedigree. |
| Regulatory tailwinds | Already there. Slide 6's tables show the alignment. |

**Net**: the AI/MCP gap is the one that's both most urgent (table stakes by year-end 2026) and most addressable atop existing engineering. That's where the next slides go.

<!--
Notes:
Three forces, three moves. The market is moving on multiple axes — naming a competitor explicitly (FINBOURNE LUSID/EDM+ with the same EDM+ name) is a small risk worth taking; BK should be aware of the naming overlap.

The "MCP is becoming table stakes" line is the load-bearing claim. KX shipping MCP is the single most important market move for our argument — it's a direct peer in the stack, and they shipped it before Xenomorph could.

Don't dwell on competitive paranoia. Frame the gap as urgency-without-panic.

Closing table is the bridge to slide 9 (what we built atop this week — xenoMCP v1.1.0-preview.2).

Pacing: ~75-90 seconds. Tables again do the heavy lifting.
-->
