# The architecture

```
   ┌─────────────────────────────────────────────────────────────┐
   │  Data sources                                                │
   │  Bloomberg · Refinitiv · ICE · S&P · 50+ vendors · internal  │
   └─────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Raw          — ingestion, data acquired as-received         │
   └─────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Silver       — normalisation, validation rules applied      │
   └─────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Gold         — validated, authoritative — the Gold Copy     │
   └─────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Downstream                                                  │
   │  Front Office · Risk systems · Excel · Python · BI tools     │
   └─────────────────────────────────────────────────────────────┘
```

## How it works underneath

- **Backing store**: SQL Server (Microsoft partner since 2008). Pluggable time-series engines — XDB, FAME, others.
- **Auth**: Integrated Security via Active Directory / Kerberos. End-user credentials never travel over external wires.
- **APIs**: Excel Function APIs ("SpreadSheet Inside"), Python CPython bindings (one `.pyd` per Python version, 3.9 through 3.14), MATLAB, .NET, REST, OData services for Power BI.
- **Deployment**: on-premise, Azure cloud, hybrid. Microsoft Azure validated at scale by Mizuho Americas' deployment.
- **Validation Dashboard**: browser-based, schedules cleansing, rollback support, four-eyes (Maker-Checker) approval, full audit trail. Stitches SharePoint + SSIS + SSRS alongside Xenomorph's own engine.

## The piece that's been waiting for a wrapper

The CPython binding `timescape.pyd` exposes the full functional surface of TimeScape — query (QL+), item lookup, time-series I/O, item code management, workspace configuration — through a clean Python API.

It's been there for years. Programmers go through it; analysts compose QL+ from Excel.

What it's never had until now: **an MCP layer that lets AI agents consume it directly**.

<!--
Notes:
The ASCII diagram is functional but ugly — in final render replace with proper visual (Mermaid, or hand-rendered against XenomorphDesignSystem tokens). The flow + tier model is what BK already knows; emphasis is on the closing line.
"It's been there for years" — celebrates the binding as already-built. We're not asking BK to commission new engineering; we're surfacing what already exists.
"What it's never had until now" — the natural setup for the next slide (or jumps to slide 9, "What we built atop, this week").
Pacing: ~75 seconds. The diagram does some of the talking; don't read it line-by-line.
-->
