# What we built atop, this week

Twelve days ago this didn't exist. Today it's tagged, released, verified end-to-end against your TimeScape v5.0 install — and **all five of the v1.5 tools we proposed are already live**.

## xenoMCP v1.0.0 → v1.1.0-preview → v1.1.0-preview.2 — shipped 2026-05-11

Repo: [`github.com/Jktfe/xenoMCP`](https://github.com/Jktfe/xenoMCP) (private). Three tags in one session:

| Tag | What landed |
| --- | --- |
| `v1.0.0` | Baseline 16 tools across TimeScape's full CPython surface. End-to-end stdio handshake verified; `BP.L = 508.0` round-trip live. |
| `v1.1.0-preview` | First v1.5 tool live: `vendor_entitlement_audit`. |
| `v1.1.0-preview.2` | All five v1.5 tools live. Two return real data (entitlements, decisions); three return structure-only with `unmet_dependencies: ["baselineMethod"]` until Brian answers the cost-reference question. |

Single-file Python server, **21 MCP tools live**, console-script install.

## The 21 tools

| Class | Tools | Status |
| --- | --- | --- |
| **Read — TimeScape** (4, open) | `version`, `query` (QL+), `itemQuery`, `workspaceGet` | All wrap `timescape.pyd` directly |
| **Read — v1.5 DCO (live data)** (2, open) | `vendor_entitlement_audit`, `dco_optimisation_decisions` | SQL-backed via `pyodbc` + Integrated Auth. Tenant-scoped. **Zero open-Q dependencies** — return real data today. |
| **Read — v1.5 DCO (structure-only)** (3, open) | `dco_savings_summary`, `dco_savings_by_desk`, `vendor_cost_summary` | Same SQL backbone. Return counts / ratios / vendor-mix + `estimated_savings.amount: null` + `unmet_dependencies: ["baselineMethod"]` until Brian answers the cost-reference question. **Shape is final; the values fill in.** |
| **Write** (7, gated) | `saveItem`, `saveItemDescription`, `saveProp`, `saveSeries`, `savePropSeries`, `itemCodeAdd`, `itemCodeDelete` | `confirm=true` required + audit |
| **Destructive** (3, gated) | `deleteItem`, `deleteProp`, `deleteSeries` | Confirm-gated; four-eyes layer planned for v1.1 |
| **Config** (1, gated) | `workspaceSet` | Confirm-gated |
| **Batch** (1, gated) | `runValidationTask` | Wraps `XTTaskProcessor.exe` with a `.tdf` path |

Each TimeScape-binding tool is a thin wrapper around the public `timescape` CPython API. The five v1.5 DCO tools are thin wrappers around read-only SQL views in `TimeScapeProcessManagement`. **No new business logic, no schema changes, no modifications to anything in `Program Files\Xenomorph TimeScape\`. We didn't write a single line of code in your codebase.**

## End-to-end verified

The wire that matters — a real read from a real instrument through every layer:

```python
>>> # via the MCP stdio protocol, dispatched to:
>>> t.itemQuery("XENO", "Reuters", "BP.L",
...             "VALUES(Code, Description, Close.LastValue)", None, {})
("BP.L", "BP", 508.0)
```

That round-trip — Claude Desktop → MCP JSON-RPC over stdio → `xenomorph-mcp.exe` → `timescape.pyd` → SQL Server (Integrated Auth) → response back through every layer — works today. The same path will work for any AI client that speaks MCP: Claude Code, Cursor, future Anthropic agents, Codex, anyone implementing the spec.

## What else landed

- **Safety contract** (`docs/CONTRACT.md`) with §0 Tenancy and Data Isolation as the foundational rule + Appendix B pre-publish compliance checklist: MCP serves customer's own data only — no cross-tenant, no Xenomorph-internal.
- **44 cross-platform tests** (was 22 at v1.0.0; +22 across the 5 new v1.5 tools) that pass on Windows + Mac + Linux without needing the live `.pyd` or live ODBC driver (both stubbed in `tests/conftest.py`).
- **Windows notes** (`docs/WINDOWS_NOTES.md`) — operational gotchas captured: DLL search 3.8+, Python version pin, auth model, admin-exe probing rules.
- **DCO Visibility v1.5 — all five tools live** (per `docs/research/DCO_RECON.md` + `V1_5_TOOL_SURFACE.md`). Two return real data immediately; three return structure-only until the cost-reference and desk-semantics conversations land. **The shape doesn't change when those answers arrive — only the figures fill in** (next slide).

## What it cost you

Nothing. No engineering hours from Xenomorph staff. No code review burden on your team. No deployment risk to existing client environments. The whole repo runs alongside your platform — never inside it.

<!--
Notes:
This is the "show, don't tell" slide. The actual code block of a real BP.L query returning 508.0 is the load-bearing piece — it proves the wrap works against the real binding, not just in theory.

The "we didn't write a single line of code in your codebase" line is the trust commitment, repeated from slide 2. Land it deliberately.

The closing "what it cost you: nothing" is the negotiating posture for the rest of the meeting. Frame the engagement as zero-friction.

The DCO_RECON.md reference is the natural bridge into slide 10.

Pacing: ~90 seconds. Slow on the code block. The hidden 30-second beat after "508.0" is where the room sees the credibility.
-->
