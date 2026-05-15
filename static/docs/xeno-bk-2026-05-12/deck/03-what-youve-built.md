# What you've built

Thirty years. Started 1995 at an equity derivatives desk at Bankers Trust. Built by people who knew firsthand what financial data management had to be because they'd lived without it.

## Five foundational pillars

| | |
| --- | --- |
| **Asset-agnostic flexible data model** | Equities, fixed income, OTC derivatives, structured products, commodities — and any emerging asset class — without database re-engineering. |
| **Native time-series** | Millisecond tick → slow-changing reference, all in one repository. Point-in-time queries. Back-testing. Multi-source consolidation. |
| **Business-friendly Workbench** | Traders, quants, PMs, risk analysts operate the platform directly. No SQL. No IT tickets. Self-service. |
| **Performance** | Billions of data points across millions of instruments processed nightly. Low disk footprint. Horizontal scalability. |
| **Backward compatibility** | *"Zero client configurations broken by an upgrade — ever."* That promise is unique in this market. |

## The data lifecycle

```
Acquire → Normalize → Enrich → Validate → Deliver
   ↓
Raw  →  Silver  →  Gold
```

Raw vendor feeds → Silver normalised + rules-validated → **Gold Copy** delivered to Front, Middle, and Back Office systems. Full lineage retained at every stage. Maker-Checker (four-eyes) controls baked into the validation workflow.

## Validation rules — four explicit classes

| Class | Used for |
| --- | --- |
| `instrument` | Single-instrument data quality (price, descriptors, statics) |
| `curve` | Yield curves, spread curves, curve evolution |
| `surface` | Volatility surfaces — option pricing inputs |
| `cube` | Swaption cubes — derivatives risk inputs |

QL+ is the query layer business users compose in, parallelised in v5.0. Excel, Python, MATLAB, R, .NET, REST — all are connection points. Numerix, FINCAD, QuantLib are first-class integrations. Bloomberg, Refinitiv, ICE Data, S&P Global, FactSet, Markit, MSCI plus 50+ vendor connectors.

This is the platform.

<!--
Notes:
This slide is a celebration, not a teach. BK knows all this — but laying it out cleanly makes the next slides land harder.
The "zero client configurations broken by an upgrade — ever" line is genuinely a moat. Almost no enterprise software vendor can claim it.
The four validation rule classes are technical detail that signals we've actually understood the platform, not just skimmed the website.
Pacing: ~75-90 seconds. Move briskly — this is the "set up" for the architectural slide that follows.
-->
