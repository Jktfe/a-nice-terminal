# The AI-fluent surface thesis

In September 2025, Matt Pick framed Xenomorph's public AI position cleanly:

> *"AI is only as good as the underlying data."*

It's the right thesis. Data trust is the unlock. The AI buyer in 2026 doesn't need another model — they need a platform that can be trusted to feed those models with regulatory-grade, validated, time-coherent reference and market data.

That's Xenomorph.

## What was missing from the thesis until now

A *surface*. An interface that AI agents can actually use to consume the platform.

The thesis describes the value (clean data → reliable AI). The market until 2026 lacked the protocol layer (clean data → *AI agent* via *what*?). MCP solves that — it's now the de facto standard for how AI agents reach external tools and data. KX shipped it. GoldenSource is iterating on it. Bloomberg has BQL-via-GPT in production.

**xenoMCP v1.1.0-preview.2 is the surface that makes Matt Pick's thesis demonstrable to a buyer in the room.**

## What an AI conversation looks like with xenoMCP in place

```
Analyst, in Claude Desktop:
  "Compare BP.L close prices for the last 30 days against Brent crude
   levels in the same window — flag any sessions where BP traded
   against the curve."

Claude:
  [calls itemQuery on XENO database, Reuters codeType BP.L, fields
   Close.LastValue + window]
  → returns the BP.L series
  [calls query on Brent reference with matching date range]
  → returns Brent levels
  [reasons over both]
  → "Of 22 trading sessions, BP closed against Brent direction on
   five days: Apr 8, Apr 17, Apr 23, May 2, May 6. The deltas range
   from −1.8% to +2.4%. The April 23 session is the largest outlier
   — corresponds to BP's earnings release that morning."
```

No SQL. No QL+ to learn. No vendor-specific syntax. The analyst asked a question in English. xenoMCP routed the right calls. TimeScape served the data. Claude reasoned over it. The answer came back grounded in *the firm's authoritative Gold Copy*, not a hallucinated estimate.

That's what "AI is only as good as the underlying data" looks like when the surface is in place.

## Where this goes — capability-graph and federation

(See `docs/research/MCP_INTERFACE.md` §5 for the engineering depth.)

Today's 21 tools are leaf-level — one tool per `timescape.*` function call or per v1.5 SQL view wrap. The strategic horizon is two extensions that play cleanly with the Maker-Checker pattern already in v1:

| Extension | What it means | Why it matters |
| --- | --- | --- |
| **Tool composition / capability-graph** | Instead of 21 individual leaf tools, expose a smaller set of *intents* — `look up an instrument`, `back-fill a series`, `validate a curve` — that compose into multi-step plans an AI agent plans then commits. The *plan* gets four-eyes approval once, not each individual leaf. | Brings AI-fluent ergonomics. Closer to how analysts think, further from how databases queries get spelled. |
| **Cross-source federation** | The same MCP shape over TimeScape + customer Excel/CSV stores + (where licensed) external sources — Bloomberg DL, Refinitiv RDP, ICE. AI client sees one surface; the MCP routes underneath. | Maps cleanly to Xenomorph's existing "single point of access to all your data" thesis. Extends the Workbench story to the AI lane. |

Both sit on the foundation v1 already lays. Neither requires changes to TimeScape itself.

**A note on the AI lane's safety boundary**: every extension — capability-graph, federation, v1.5 DCO Visibility, future natural-language QL+ generation — inherits the §0 Tenancy and Data Isolation rule. AI agents querying through xenoMCP operate inside the calling customer's tenant only, under the customer's AD identity. There is no Xenomorph-side cross-customer aggregation layer, no central AI-routing service that sees customer queries, no telemetry that leaves the customer host. The AI surface extends *the customer's existing trust boundary* outward to their AI tooling — it does not introduce a new boundary that crosses customers. (See `docs/research/KEITH_NEEDS_TODAY.md` for the full security/compliance non-negotiables.)

## Where this leads — three audiences

Three audiences buy what becomes possible:

| Audience | What they buy |
| --- | --- |
| **Existing G-SIB clients** | "Your traders / analysts / risk teams can now query their validated data in natural language." The platform doesn't change. The conversation around it transforms. |
| **AI-fluent new buyers** | "Looking for an EDM with an MCP surface? Most don't have one yet. KX does. We do too." Joining the table-stakes club early. |
| **Internal teams at Xenomorph** | Builds new product lanes. v1.5 DCO Visibility is the first; v2 could surface validation rules to natural-language editing; v3 could expose lineage for AI-assisted audit. The roadmap opens once the surface is there. |

The thesis was right. The surface is now real. The combination — data trust *with* AI access — is what nobody else in this space has assembled into one product.

<!--
Notes:
This is the strategic slide. The earlier slides showed *what is*; this one shows *what it means*.

The Matt Pick quote is the anchor — citing it explicitly shows we've read Xenomorph's own public material and are extending their existing position, not imposing an external one.

The Claude Desktop dialogue example is the demo-narrative. If there's a live demo at the meeting, this is the script for it. If not, the slide carries the story.

"Joining the table-stakes club early" is the urgency frame without being alarmist.

The three audiences in the table is the "where the commercial value lands" slice — short, direct, ready for follow-up Q&A.

Pacing: ~90-105 seconds. The Claude Desktop example is the centrepiece — read it slowly enough that the room hears the contrast (English in, structured answer out).
-->
