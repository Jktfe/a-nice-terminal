# xenoMCP — MCP/agent interface research doc

> Engineering-side companion to the BK deck. **For Brian.** Depth on architecture, tradeoffs, safety, and where this goes in v2/v3. Sibling doc to `DCO_RECON.md` (which this references rather than duplicates).

---

## TL;DR

We've wrapped Xenomorph TimeScape's documented CPython API surface (`timescape.pyd`) as a Model-Context-Protocol stdio server. Sixteen baseline tools cover the full v4.x/v5.0 programmer surface (eleven Maker-Checker-gated, four open reads, one batch task wrapper); five additional v1.5 DCO Visibility tools wrap read-only `TimeScapeProcessManagement` SQL views — 21 tools total. End-to-end verified on TimeScape v5.0 — `BP.L` from `XENO` round-trips through stdio → tool dispatch → `t.itemQuery()` → SQL Server → back in milliseconds. Repo: `https://github.com/Jktfe/xenoMCP`, tagged `v1.1.0-preview.2` (16 baseline tools shipped as `v1.0.0`; v1.5 DCO Visibility shipped as `v1.1.0-preview` then `v1.1.0-preview.2`).

We did not touch a line of Xeno's code. The MCP server lives outside the install, depends only on the public CPython binding + Anthropic's `mcp` Python SDK, and the .pyd file finds its native DLLs via `os.add_dll_directory()` at startup. Removing the MCP server leaves TimeScape exactly as it was.

The v1.5 lane is **DCO Visibility**: surface the data-cost-optimisation savings TimeScape already delivers but currently doesn't expose legibly. Schema-side recon complete; gated on cost-reference data we need from Brian / Keith before tool implementation.

---

## 1. Architecture

```
                 ┌──────────────────────────────────────────┐
                 │  AI client (Claude Desktop, Claude Code, │
                 │  Cursor, anything that speaks MCP)       │
                 └──────────────────────┬───────────────────┘
                                        │  JSON-RPC over stdio
                                        ▼
                 ┌──────────────────────────────────────────┐
                 │  xenomorph-mcp.exe                       │
                 │  (uv-built wheel + FastMCP dispatcher)   │
                 │  • bootstrap: os.add_dll_directory()     │
                 │    for Program\ + (x86)\Program\         │
                 │  • 21 tools registered via @mcp.tool()   │
                 │  • Maker-Checker confirm-gating          │
                 │  • CONTRACT §0 tenancy invariant         │
                 └──────────────────────┬───────────────────┘
                                        │  in-process Python call
                                        ▼
                 ┌──────────────────────────────────────────┐
                 │  timescape.pyd (TimeScape CPython API)   │
                 │  • Xenomorph-built, unchanged            │
                 │  • per-Python-version (.pyd for 3.9-14)  │
                 └──────────────────────┬───────────────────┘
                                        │
                            ┌───────────┴───────────┐
                            ▼                       ▼
                    ┌──────────────┐        ┌──────────────┐
                    │ TimeScape    │        │ Native DLLs  │
                    │ services     │◀──────▶│ in Program\  │
                    │ (.NET, EDM+) │        │ (Xenomorph)  │
                    └──────┬───────┘        └──────────────┘
                           │
                           ▼
                    ┌──────────────────────────────────────┐
                    │  SQL Server 2022 (Integrated Auth)   │
                    │  GOLD, SILVER, RAW, PUBGOLD,         │
                    │  PUBSILVER, TimeScapeProcessMgmt     │
                    └──────────────────────────────────────┘
```

**Process model:** one MCP server process per AI-client session, started on-demand by the client over stdio. No long-running daemon, no listening ports, no inbound network surface from outside the host. Stops cleanly when the client disconnects.

**Why MCP, not REST:**
- MCP is the emerging open standard (Anthropic, OpenAI, others lining up) for agent → tool plumbing. Native in Claude Desktop, Claude Code, Cursor — zero wrapper code on the client side.
- Stdio is the lowest-friction transport on Windows where TimeScape lives: no port to allocate, no firewall rule, no TLS cert, no auth proxy. The MCP client and server share the user's logon session, so Integrated Auth into SQL Server "just works".
- The same JSON-RPC tool schemas serve as input validation, OpenAPI-like documentation, and AI-tool affordance, in one definition.

**Why Python, not Node:** the CPython `timescape.pyd` is the documented binding. Anything else would be FFI / shelling out to .NET API DLLs / `subprocess`-ing admin exes — all of which we explored and rejected in favour of the native binding (see commit history + `DCO_RECON.md`).

**Bootstrap nuance worth flagging:** Python 3.8+ removed PATH from extension-module DLL search. `timescape.pyd` depends on native DLLs in `C:\Program Files\Xenomorph TimeScape\Program\` and the x86 sibling. The server registers both via `os.add_dll_directory()` at module-load time, before `import timescape` — without that, `ImportError: DLL load failed`. Defaults point at the standard install locations; both overridable via `XENOMORPH_TIMESCAPE_PATH` and `XENOMORPH_PROGRAM_PATH` env vars.

---

## 2. Tool surface

Sixteen tools across five classes. Each is a thin wrapper over one `timescape.*` function, with parameters reshaped to JSON-friendly types (ISO date strings instead of Python `date` objects, lists-of-lists for series data).

| Class | Count | Tools | Gating |
|---|---|---|---|
| **Read** | 4 | `version`, `query`, `itemQuery`, `workspaceGet` | None — execute unconditionally |
| **Write — single item** | 3 | `saveItem`, `saveItemDescription`, `saveProp` | `confirm: bool` required |
| **Write — codes** | 2 | `itemCodeAdd`, `itemCodeDelete` | `confirm: bool` required |
| **Write — series** | 2 | `saveSeries`, `savePropSeries` | `confirm: bool` required |
| **Destructive** | 3 | `deleteItem`, `deleteProp`, `deleteSeries` | `confirm: bool` required |
| **Config** | 1 | `workspaceSet` | `confirm: bool` required |
| **Batch** | 1 | `runValidationTask` (XTTaskProcessor + .tdf) | `confirm: bool` required |

**Maker-Checker (four-eyes) pattern:** every non-read tool takes a `confirm: bool` argument that defaults `false`. A call without `confirm=true` returns a structured `{needs_confirmation: true, operation, preview, message}` object describing exactly what would have run, and **does not execute**. The calling agent (or its human supervisor) must explicitly re-call with `confirm=true` to commit. The pattern is uniform across the 12 gated tools — there's no per-tool special case.

**Why uniform gating, not per-tool risk grading:** keeping the contract identical across all writes makes the tool surface predictable for agents *and* auditors. Per-tool risk classification (e.g. `saveProp` lower-risk than `deleteItem`) is the kind of thing a downstream rule engine should layer on top — the MCP server's job is to refuse cleanly and consistently, not to encode policy.

**Live verification (post-tag, on TimeScape v5.0):**
```
xenomorph-mcp.exe → initialize → server=xenomorph-timescape, protocol=2025-11-25
xenomorph-mcp.exe → tools/list  → 21 tools (full surface, baseline + v1.5)
xenomorph-mcp.exe → tools/call version       → {"ok": true, "version": "5.0"}
xenomorph-mcp.exe → tools/call itemQuery(XENO, Reuters, BP.L, ...) → [["BP.L", "BP", 508.0]]
xenomorph-mcp.exe → tools/call query(Item(%database%, %code%).Close.LastValue, ...) → 508.0
xenomorph-mcp.exe → tools/call saveItem(... no confirm) → {needs_confirmation: true, ...}  ← no execution
xenomorph-mcp.exe → tools/call deleteItem(... no confirm) → {needs_confirmation: true, ...}  ← no execution
```

---

## 3. Safety contract

Captured separately in `docs/CONTRACT.md`. Headlines:

- **§0 Tenancy and data isolation (foundational).** The MCP serves the customer's own data only. No Xenomorph internal data, no cross-tenant aggregates, no other clients' data. This is foundational, not negotiable.
- **Confirm-gating** uniform across the writes (Section 2).
- **Audit log** of every tool dispatch (request + outcome + confirm status). JSONL, in the customer's filespace, redaction-aware (token-shaped strings replaced before serialisation).
- **GUI binaries are never wrapped.** `XTWorkbench64`, `XTDriverWizard64`, `XTOfficeAdmin`, etc. are admin GUIs and would hang on `/?`; they are explicitly out of scope.
- **Internal Windows services are never invoked directly.** EDM+ services, DCO Monitor, etc. host the engine; the MCP reads their persisted state (via the CPython binding or, for v1.5, directly via SQL views), not their RPC.

---

## 4. DCO recon — pointer + headline

Full recon in `docs/research/DCO_RECON.md`. One-paragraph version:

DCO state lives in `TimeScapeProcessManagement` (SQL Server 2022 on the host, Integrated Auth). Fifteen relevant tables; twenty-seven views. The two highest-value views are `BloombergRequests` (one row per outbound Bloomberg API request, with bit-flags for `RequestUploaded` / `ReplyDownloaded` / `DataLoaded` / `RequestError`) and `RequestSubstitutes` (the alternative-vendor mapping that says *"when this kind of request arrives, serve it from this internal DataSource instead"* — i.e. the direct savings driver). DCO is not exposed on the public programmer surface (`timescape.pyd` / C API / .NET API / `APIs, SDKs, Examples/`), which is why the savings story isn't legible today: there's no programmer entrypoint to ask the question. The v1.5 surface implements those entrypoints by reading the SQL views directly.

Four open questions for Brian (also in the recon doc, repeated here for prominence):
1. **Cost reference:** where do per-request / per-record prices live? Bloomberg DL has tier pricing; the schema doesn't obviously hold it.
2. **"Desk" / org dimension:** does `EntityProcesses.EntityProcessID` map to the business concept of "desk", or is there a higher-level dimension?
3. **Substitution-success semantics:** when a `RequestSubstitutes` row fires, is it always a clean savings event, or is there a non-visible fallback path?
4. **Demo data:** the dev box DB is empty (0 rows). To show v1.5 in action we need synthetic data, an anonymised client extract, or screenshots from a reference deployment with permission.

---

## 5. v2 / v3 roadmap

**v1.5 — DCO Visibility (next).** Five additional read-class tools surfacing the DCO savings/decisions/entitlements that already exist in the schema. See `DCO_RECON.md` for the mapping table. Implementation is straightforward once the open questions above resolve. Estimate: 1–2 days of code once the cost-reference question is answered, plus testing window for live demo data.

**v2 — Multi-tenant and remote.** Today the MCP runs alongside TimeScape on the customer's host, talking to the customer's local SQL via Integrated Auth. v2 extends to:
- **Per-room / per-customer credentials**, when a single deployment serves multiple tenants (relevant if Xeno hosts MCP-as-a-service rather than each customer installing it themselves).
- **Transport options beyond stdio:** WebSocket or Server-Sent-Events with bearer tokens, for AI clients that aren't co-resident with TimeScape.
- **Read-only mode flag** that disables the entire write/destructive class, for customer deployments where AI is for exploration only.

**v3 — Federated and capability-graph.** Two extensions that get speculative but real for the AI-fluent thesis:
- **Tool composition / capability-graph:** instead of 21 individual tools, expose a smaller set of "intents" (`look up an instrument`, `back-fill a series`, `validate a curve`) that compose into multi-step plans the AI plans then commits. Plays cleanly with the Maker-Checker pattern — the *plan* gets approved once, not each leaf.
- **Cross-source federation:** the same MCP shape over TimeScape + customer-specific Excel/CSV stores + (where licensed) external data sources (BBG DL, RDP, ICE). AI client sees one surface; we hide the routing. Xeno's existing data-fabric thinking maps cleanly here.

---

## 6. Open engineering questions for Brian (beyond DCO)

1. **TimeScape version cadence and CPython binding ABI:** if a customer upgrades TimeScape, does `timescape.pyd` change shape? The .pyd we ship against is the v3.13/64-bit binding from the v5.0 install on the engagement laptop. Per-Python-version `.pyd` files are documented in the install — what's the binding's compatibility story across TimeScape minor versions?

2. **Audit log integration:** the MCP writes its own JSONL audit. Does TimeScape have an existing audit trail (DB-level CDC, EDM+ logging, etc.) that we should join into / forward to, rather than running parallel?

3. **Connection / threading model:** the .pyd uses some implicit connection management to SQL Server. For a long-running MCP server fielding many tool calls, what's the right pooling / connection-lifecycle posture? Is the .pyd thread-safe?

4. **Subset of v1 tools that aren't safe to call from an AI:** is there anything in our 16 we *should* refuse to expose, even with confirm-gating, because of how it interacts with downstream EDM+ rules (e.g. `saveProp` that bypasses a validation pipeline)?

5. **Brian's view on v3 federation:** Xeno's positioning has long emphasised the "single point of access to all your data" thesis. Does it sit well to extend that thesis from the human-facing Workbench to the AI-facing MCP surface? Or is there a reason the AI lane should stay strictly TimeScape-native?

---

## 7. Why this matters for BK

Keith framed the missed commercial story as: *"DCO already saves clients millions vs raw Bloomberg spend, but Xeno doesn't surface the savings — clients have to compute the delta themselves."* The same observation generalises beyond DCO: TimeScape's 30 years of engineering depth means the *capability* is there, but the *legibility* of that capability — for buyers, for analyst end-users, for the AI tools their customers' juniors are increasingly using — has fallen behind the market. The MCP surface is the moment we make those capabilities legible without touching the underlying engine. v1 proves the integration works against the live binding; v1.5 makes Keith's commercial story self-evident; v2/v3 expands the surface to where the market is going.

---

## Appendix A — files of interest

- `server.py` — single-file MCP server, 21 tools, ~1030 lines.
- `pyproject.toml` — `hatchling` build, `tool.uv.package = true`, console-script `xenomorph-mcp = server:main`.
- `docs/CONTRACT.md` — safety contract with §0 Tenancy.
- `docs/research/DCO_RECON.md` — full DCO recon (this doc references its findings, doesn't duplicate).
- `docs/WINDOWS_NOTES.md` — Windows-specific gotchas captured during engagement.
- `tests/` — 22 tests, cross-platform via a `timescape` stub.
