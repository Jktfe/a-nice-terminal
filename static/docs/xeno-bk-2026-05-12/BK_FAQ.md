# BK FAQ — anticipated questions with answers

> Inverse artefact to [`BK_QUESTIONS.md`](BK_QUESTIONS.md). That doc is what we need from Brian; this doc is what Brian (and Keith, and any other reviewer in the room) is likely to ask us — with prepared answers. Organised by category so the room can riff in any direction without us scrambling.

---

## A. Safety / governance

### "Could one customer's MCP see another customer's data?"

No. The MCP runs on the customer's own TimeScape host, under the customer's own Windows / AD identity. Integrated Security against SQL Server scopes every query to that identity's permissions. Cross-tenant isolation is the **same boundary that TimeScape itself relies on today** — the MCP doesn't add a new lane, it inherits the existing one. CONTRACT §0 makes this a foundational rule in the codebase: no Xenomorph-internal data, no cross-tenant aggregates, no other clients' data. ([`docs/CONTRACT.md`](CONTRACT.md))

### "What stops the AI from running away with our golden master?"

Twelve of the sixteen tools refuse on the first call. They return a structured `{needs_confirmation: true, operation, preview, message}` response, **do not execute**, and require the caller to re-invoke with `confirm=true` to commit. The pattern is uniform — there's no exception, no per-tool shortcut. A downstream rule engine (a workflow approval system, a four-eyes signature requirement) can intercept between the two calls without touching the MCP code. ([`docs/examples/03-back-fill-series.md`](examples/03-back-fill-series.md) walks a single write through this end-to-end.)

### "How is the user's identity carried?"

It isn't carried — it's inherited. The MCP server runs as a child process of the Claude Desktop / Claude Code session, which is running as the logged-in Windows user. SQL Server sees that user via Integrated Auth (Kerberos). The MCP wire never carries credentials, tokens, or impersonation headers. Every tool call resolves through TimeScape's existing identity context.

### "What about audit?"

Every tool dispatch produces a JSONL line: timestamp, tool name, parameters (redacted for token-shaped strings), confirm status, outcome. Lives in the customer's filespace (default `~/.xenomcp/audit.jsonl`), so it can be SIEM-shipped, grep'd, or rotated by their existing log infrastructure. Open question A6 in [`BK_QUESTIONS.md`](BK_QUESTIONS.md) is whether to also forward into an existing TimeScape audit trail — that's a join, not a replacement.

### "If the MCP misbehaves, what's the blast radius?"

Bounded to what the calling Windows user can already do via TimeScape today. The MCP doesn't elevate privileges, doesn't open new write paths the .pyd doesn't expose, doesn't bypass EDM+ validation rules. Worst case is "a misconfigured AI deletes one item it was confirmed to delete" — same blast radius as a sleepy operator clicking the wrong row in Workbench.

### "Does this need internet?"

No. Stdio transport, in-process Python call to `timescape.pyd`, local SQL Server. The MCP runs on air-gapped hosts. No outbound calls from the server.

---

## B. Architecture

### "Why MCP and not a REST gateway?"

MCP is the emerging open standard for AI-to-tool wiring (Anthropic, OpenAI, several others lining up). Claude Desktop, Claude Code, Cursor and similar clients speak it natively — zero adapter code. Stdio transport on Windows is the lowest-friction option: no port to allocate, no firewall rule, no TLS cert, no auth proxy. A REST gateway adds all of that without adding a feature an AI client could use that MCP can't.

### "Why Python, not .NET?"

The CPython `timescape.pyd` is the documented binding shipped in your SDK at `APIs/CPython/v3.13/64-Bit/`. Going through it means we use TimeScape's own published external integration surface — the same one your .NET API mirrors — rather than reaching deeper into the engine. .NET would be fine too; the deciding factor is that Anthropic's MCP SDK is more mature in Python today and that single-file Python ships with less ceremony than the equivalent .NET single-file deployable.

### "Why one server per session, not a daemon?"

Two reasons. (a) Identity: the per-session model means the server runs as whichever user is sitting at the AI client, which is the right SQL identity for that user's queries. A daemon would have to impersonate. (b) Lifecycle: a server lasts as long as the AI session, exits cleanly on EOF, leaves no orphaned process. Daemon mode is on the v2 table if customers ask for shared-tenancy deployment.

### "What's the install footprint?"

The MCP wheel is under 1 MB (`server.py` ≈ 14 KB, plus the MCP SDK ≈ 100 KB plus pydantic ≈ 5 MB). The Python 3.13 runtime via `uv` is ~30 MB. The `timescape.pyd` is your file — already on disk. Net new disk: ~40 MB. Net new processes: none until an AI client starts a session.

### "Does it depend on anything we ship breaking compatibility?"

The CPython binding (`timescape.pyd`) version-locks to a Python minor (3.13 today). If a TimeScape release ships a new `.pyd` for the same Python minor, we recompile against it. If TimeScape goes to a Python major (3.14 →) we ship a parallel install. Open question A5 in [`BK_QUESTIONS.md`](BK_QUESTIONS.md) is what your binding-compat policy is.

---

## C. Operational

### "How do we install it?"

```cmd
cd <repo>
uv sync         # one-time, fetches Python 3.13 + deps
```
Then add an entry to `%APPDATA%\Claude\claude_desktop_config.json`:
```jsonc
{
  "mcpServers": {
    "xenomorph-timescape": {
      "command": "<repo>\\.venv\\Scripts\\xenomorph-mcp.exe"
    }
  }
}
```
Restart Claude Desktop. Tool count shows in the UI. ([`README.md`](../README.md) has the full quickstart.)

### "How do we uninstall it?"

```cmd
uv pip uninstall xenomorph-mcp
```
Plus delete the `mcpServers` entry. TimeScape is untouched. There is no service to stop, no scheduled task to delete, no registry entry to remove.

### "What happens if Claude Desktop crashes?"

The server is a child of the Claude Desktop process. Crash → child terminates → server exits → SQL connections close cleanly. Next launch starts a fresh server. No state to recover.

### "What if the .pyd version mismatches the Python venv?"

`ImportError: DLL load failed`. The bootstrap registers `os.add_dll_directory()` for both `Program\` install dirs before `import timescape`, which is the common cause of that error; if the user has somehow installed a `.pyd` for a different Python minor in our venv's path, they get a clearer error. The startup sequence logs the resolved paths to stderr so the failure is diagnosable in 30 seconds.

### "Can we deploy this without root / admin?"

Yes. `uv` is per-user. The venv is in the project directory. No system-wide writes. Claude Desktop's config file is in the user's AppData. The whole thing installs without privilege elevation.

---

## D. Roadmap

### "When's v1.5?"

2–3 days of bench-time from the day Brian + Keith answer the four pricing/dimension/semantics questions. See the implementation order in [`docs/research/V1_5_TOOL_SURFACE.md`](research/V1_5_TOOL_SURFACE.md). Two of the five tools (`vendor_entitlement_audit`, `dco_optimisation_decisions`) have zero open-Q dependencies and ship day-1.

### "What's in v2?"

Three things: (a) deployment mode for multi-tenant hosts (today the assumption is one MCP per customer host); (b) transport options beyond stdio (WebSocket / SSE with bearer tokens for AI clients that aren't co-resident); (c) a read-only flag that turns off the entire write/destructive class for customer deployments where AI is for exploration only.

### "And v3?"

Speculative but worth flagging. Two ideas: capability-graph (smaller set of "intents" — `look up an instrument`, `back-fill a series`, `validate a curve` — that compose into multi-step plans the AI plans then commits; plays cleanly with Maker-Checker because the plan gets approved once, not each leaf), and federation (the same MCP shape over TimeScape + customer flat files + licensed external sources). v3 is "what if we extend Xeno's single-point-of-access thesis to AI", and it's gated on whether you want us to.

### "What about open source?"

Repo is `Jktfe/xenoMCP` private today. Open question D3 in [`BK_QUESTIONS.md`](BK_QUESTIONS.md). Three obvious end-states: stays private (Xeno contractor work), transfers to a Xenomorph org (Xeno-owned product), open-sourced as a community reference (with Xenomorph attribution). We'd want your call before forming a roadmap commitment either way.

---

## E. Commercial

### "How does this help us sell?"

Two threads. (a) It makes existing capabilities legible. The DCO savings story already exists in your engine; we make it grep-able from natural-language. A buyer who'd previously have to interpret a `RequestSubstitutes`-shaped dataset can now ask "what did we save on Bloomberg last month" and get a sentence. (b) It positions Xenomorph in the AI-fluent column when buyers are comparing platforms. Right now "does it have an AI surface" is a yes/no question at the RFP stage; this turns yours to yes without changing your engine.

### "What's the customer message?"

*"Your existing TimeScape investments now have a Claude-fluent doorway. No new engine, no new licence, no new infrastructure. Your analysts ask questions in English; your engine answers them in QL+ — the same QL+ you've been using since 1997, generated by an AI from natural language."*

That's the elevator. Then we walk through DCO Visibility (slide 10) as the proof point: the savings story your customers have wanted you to surface, surfaced.

### "What's the price point?"

Not a question this engineering work can answer. ([`docs/research/KEITH_NEEDS_TODAY.md`](research/KEITH_NEEDS_TODAY.md) raises the "customer-facing vs internal sales enablement" framing — question B1 in [`BK_QUESTIONS.md`](BK_QUESTIONS.md) — which is upstream of pricing.)

### "How big is the market?"

Every TimeScape customer is a candidate by default — they already have the engine. The question is which seats inside each customer. v1.5's primary persona is open (question D1 in BK_QUESTIONS) but the obvious candidates are quant-analyst seats (who pay for productivity tools) and ops/data-engineer seats (who pay for time-back-from-toil tools).

---

## F. Competitive

### "What if Bloomberg ships their own MCP for DL?"

They might, and that's fine. Our wedge isn't "AI for Bloomberg data"; it's "AI for *your data already inside TimeScape, including the DCO-optimised view of Bloomberg data*". The composition is the moat. A Bloomberg-direct MCP shows raw vendor data; ours shows TimeScape's filtered, joined, governed, EDM+-shaped data. Same security, same lineage.

### "Doesn't this commoditise our query engine?"

The opposite. A more legible engine is a more sticky engine. AI tools surface capability that humans can use; that increases dependence on the underlying engine, not less. The risk to be careful about isn't commoditisation — it's losing visibility into how the AI is using the engine, which is exactly what the audit log + Maker-Checker pattern is built to prevent.

### "How is this different from an ETL out to a data lake?"

Three differences. (a) **In-place.** ETL moves data; MCP queries in-place against the live engine. No staleness, no data duplication, no governance regression. (b) **Bidirectional.** ETL is one-way; MCP exposes writes too (gated). A data lake can show a customer their DCO savings but can't let them ask the engine to back-fill a missing series. (c) **Auth posture.** ETL typically uses a service account with broad access; MCP runs as the calling user with their own scope.

### "Could KX / Bloomberg / FINBOURNE do this?"

KX already has — their MCP for KDB-X shipped earlier this year. Bloomberg might. FINBOURNE LUSID is the more direct lookalike and worth watching (their EDM+ naming clash with yours is a separate issue). Our timing advantage is that "MCP for legacy-engine" is now table stakes and Xeno was strong enough to get there fast. The lead is in months not years.

---

## G. Implementation depth

### "Who maintains this?"

Currently `@xenoCC` (Claude on Xenoʼs Windows box, in the engagement laptop) is the implementation lead; `@xenobridgeclaude` (Claude on the engagement Mac mini) is the docs/deck lead; `@xenoCodex` is the security/compliance reviewer. Net human effort to date: hours, not weeks. Sustaining engineering past v1.5 is a question your team and ours work out together — see also the Open question D3 on repo ownership.

### "What's the testing story?"

22 unit tests in `tests/` covering the helpers + the confirm-gating contract. They mock `timescape.pyd` via a stub in `tests/conftest.py`, so they pass on Mac / Linux / Windows uniformly. Cross-platform CI is straightforward to add. We deliberately don't ship integration tests that hit a real TimeScape because the test infrastructure isn't where the value is for v1.0 — it's the surface contract.

### "What about performance?"

A `version()` round-trip through Claude Desktop's MCP wire + our stdio + tool dispatch + the `.pyd` + your SQL is on the order of 50–100ms on the engagement laptop. `itemQuery` for a single instrument is similar. The bottleneck is your SQL Server, not the MCP plumbing. Long-running queries are bounded by the underlying engine, not us.

### "Is the code reviewable?"

Yes. ~340 lines of Python in `server.py`, single file, no inheritance graph, every tool is a thin wrapper. 22-test pytest suite. Two research docs (`MCP_INTERFACE.md`, `DCO_RECON.md`) plus a safety contract (`CONTRACT.md`). Brian's engineers can read everything in an afternoon.

---

## H. Failure modes

### "What if SQL Server is down?"

Tools that hit SQL return `{ok: false, error: "<sqlcmd-style error>", kind: "OperationalError"}` — same shape as any other failed read. AI client surfaces the error to the user; nothing catastrophic happens. Doesn't bring down the MCP server.

### "What if the .pyd version mismatches?"

Server exits on startup with `ImportError: DLL load failed` (clear log line). User updates the venv or rolls back. Better than a runtime mystery.

### "What if Bloomberg DL changes its protocol?"

The MCP doesn't talk to Bloomberg DL directly — TimeScape does. A Bloomberg protocol change ripples to TimeScape and is your problem to absorb; we read the same `BloombergRequests` view either way.

### "What if a customer's TimeScape upgrade breaks the .pyd ABI?"

We ship a new MCP release pinned to the new `.pyd`. Open question A5 covers the policy.

### "What if a customer mis-installs Claude Desktop config?"

Tool count shows `0` in the Claude Desktop UI. Symptom is obvious; fix is editing one JSON file. We could add a `xenomorph-mcp doctor` subcommand in v1.5 if customer-support load justifies.

---

## I. The disarming questions

### "Could you have built this faster without the MCP overhead?"

Yes — a `.cmd` wrapper around `XdbExport.exe` + a Python parser + a Flask endpoint would have taken half the time. It would also have been brittle, single-tenant, hard to audit, and unidiomatic for AI clients. The MCP design is the cheap option for *every interaction after the first*.

### "Why should we trust 'AI built this'?"

Two specifics: (a) Every commit is human-attributable via the `Co-Authored-By` lines in the git log; the AI agents (`@xenoCC`, `@xenobridgeclaude`, `@xenoCodex`) are co-authors, not sole authors. (b) The safety contract (`CONTRACT.md` §0 Tenancy) was reviewed and folded in by xenoCodex specifically for compliance posture. The output is auditable.

### "What's the catch?"

The open questions in [`BK_QUESTIONS.md`](BK_QUESTIONS.md) are the catches. None of them are deal-breakers; all of them are decisions that need to be made before v1.5 ships with confidence. The deck is honest about which numerics depend on Brian/Keith input.

### "Why now?"

Because waiting is the more expensive option. Every quarter you go without an AI surface, the next customer evaluation has "doesn't have an AI lane" as a checkbox-fail. The work to retrofit one becomes harder the longer the engine evolves without it. Building it now, against a v5.0 release, is the cheap moment.
