# Safety Contract — xenoMCP

This document is binding on every tool added to `server.py`. Read it before adding, removing, or modifying any tool. The rules exist because the TimeScape platform underpins regulatory data lineage at G-SIB clients, and an MCP layer over it must be auditable, reversible, and **tenant-isolated** by construction.

## 0. Tenancy and data isolation — foundational rule

**The MCP serves the end customer's own data only.** It is deployed *into* a customer's TimeScape host and operates within that customer's tenant.

What this means in practice:

- The server runs in-process on the customer's TimeScape host under a Windows service account that the customer controls. SQL Server authentication flows through that account's Active Directory / Kerberos context via Integrated Security (see §6). The `timescape.pyd` binding can only read what that AD account is authorized to read.
- **No tool may expose data outside the calling tenant.** That includes (non-exhaustively): Xenomorph internal corporate or operational data, Xenomorph competitive intelligence, Xenomorph sales / pipeline / customer-list information, other Xenomorph clients' data, or any aggregated cross-customer figures.
- **No tool may exist whose purpose is cross-tenant or Xenomorph-internal reporting.** A tool like `list_xenomorph_customers`, `competitive_market_share`, or `internal_pipeline_summary` is a contract violation by name; do not add one.
- **Read tools that wrap binding calls (`query`, `itemQuery`) are tenant-isolated by construction** — the AD service account cannot see other tenants' databases.
- **DCO Visibility tools (v1.5 plan)** must scope every figure to the calling tenant. `dco_savings_summary` shows the caller's own savings. Never aggregated-across-clients. Never another tenant's figures. Never the Xenomorph-internal P&L on the savings.
- **`run_task` / batch tools** that shell out to `XTTaskProcessor.exe` must only execute `.tdf` files owned by the calling tenant. They must not run vendor-supplied or Xenomorph-supplied tasks that span tenants.
- **Audit logs** record tool calls and outcomes. They do not record tenant data values beyond what's needed for the preview (which is the caller's own data anyway), and they live on the customer host — never centralised at Xenomorph.

If a tool design feels like it crosses any of these lines, stop and check with James / Keith / `@xenoCC` before writing it. Multi-tenancy violations are the kind of mistake that's invisible in code review and only surfaces in a breach.

## 1. Tool classes

Every `@mcp.tool()` function falls into exactly one class:

| Class | `confirm` arg? | Without `confirm=true` | With `confirm=true` |
| --- | --- | --- | --- |
| **Read** | no | executes | (n/a) |
| **Write** | yes, default `False` | returns `needs_confirmation` preview, no side effect | executes |
| **Destructive** | yes, default `False` | returns `needs_confirmation` preview, no side effect | executes |
| **Config** | yes, default `False` | returns `needs_confirmation` preview, no side effect | executes |
| **Batch** | yes, default `False` | returns `needs_confirmation` preview, no shell-out | executes the `.tdf` via `XTTaskProcessor.exe` |

Read tools are *always* unguarded. Adding a `confirm` argument to a read tool is a contract violation — the caller is given the choice of when to read by virtue of choosing whether to call the tool at all.

Write, destructive, config, and batch tools are *always* gated. Removing the `confirm` check from a tool in those classes is a contract violation. There is no admin override.

## 2. The `needs_confirmation` shape

When a gated tool is invoked without `confirm=true`, it returns:

```python
{
  "needs_confirmation": True,
  "operation": "<tool_name>",
  "preview": { ...all arguments the caller supplied... },
  "message": "<tool> is a write/destructive operation. Review the preview above and re-call with confirm=true to execute.",
}
```

The preview is the caller's chance to see exactly what would happen. It must include every parameter that affects the side effect — including ones with defaults. The `_needs_confirm()` helper in `server.py` enforces this; do not bypass it.

## 3. The `ok` envelope

Every tool response is one of three shapes:

- Success: `{"ok": True, ...result fields...}`
- Failure: `{"ok": False, "error": "<message>", "kind": "<exception class name>"}`
- Needs confirmation: `{"needs_confirmation": True, ...}` (see §2)

The `_err()` helper produces the failure shape from a caught exception. Tools must catch `t.error` (TimeScape's single exception type) at minimum. Other exception types — `subprocess.TimeoutExpired`, `OSError`, `FileNotFoundError` — should be caught where they can occur. **Never let an exception propagate out of a tool.**

## 4. Read tools — current

- `version()` → `{ok, version}`
- `query(query, dataRule="", queryArgs=None, server="")` → `{ok, data}`
- `itemQuery(database, codeType, code, query, dataRule="", queryArgs=None)` → `{ok, data}`
- `workspaceGet(setting)` → `{ok, value}`

Adding a read tool requires it be free of side effects and free of `confirm` arguments.

## 5. Destructive tools — additional protection planned for v1

The four destructive tools (`deleteItem`, `deleteProp`, `deleteSeries`, `itemCodeDelete` — currently classed as write but operationally destructive) are gated by `confirm=true` today. **For v1 they will additionally require a four-eyes (Maker-Checker) approval**:

- The first caller "stages" the deletion, receives a `change_id`, and the deletion does **not** execute.
- A second caller — necessarily *not the same identity* as the staging caller — must approve by referencing the `change_id`.
- The MCP records both the maker and the approver and refuses self-approval, regardless of the caller's authority.

This mirrors TimeScape's Validation Dashboard semantics and is required for any BCBS 239 / FRTB-relevant deployment. The state lives in a persisted JSON file (path overridable via env). Until the four-eyes layer ships, deployments to environments holding sensitive data should disable the destructive tools at the MCP-config level.

## 6. Auth

The MCP server inherits the Windows process identity it runs under. SQL Server authentication flows through that identity's AD/Kerberos context (Integrated Security). **End-user credentials are never transmitted over the MCP wire.** A client that wants to act as a specific user must run a server instance under that user — there is no in-protocol impersonation.

## 7. Stdout discipline

`stdout` is the MCP transport. **Never `print()` to stdout**, never `sys.stdout.write()`, never any library that defaults to stdout. Diagnostics go to `stderr` via `sys.stderr.write()` or `logging` configured to stderr.

Violations corrupt the JSON-RPC stream and silently break the MCP session.

## 8. Sensitive args + audit log (v1)

When the audit log lands (planned v1), the registry will redact common sensitive keys (`password`, `token`, `secret`, `apikey`, `api_key`, `authorization`) before writing to the JSONL log. Tools that take secrets in non-standard parameter names must explicitly mark them so the redaction layer can see them.

Until the audit log lands, do not log tool calls anywhere.

## 9. Boundaries that never relax

- GUI binaries (`XTWorkbench64.exe`, `XTDriverWizard64.exe`, `XTOfficeAdmin.exe`) are **never wrapped**. MCP has no display.
- TimeScape Windows services (`xtedm.exe`, `*.Service.exe`, `XTDCOMonitorService.exe`) are **never invoked directly**. Service Control Manager owns them.
- The X*-prefix admin binaries (`XdbExport`, `XdbImport`, `XdbRuleExport`, `LoadIt64`, `XListDataLoader`, `TSBackup`, `TSRestore`, etc.) are **not wrapped as MCP tools** — they're for human DBA workflow. The Python binding is the integration surface; the admin exes are operational tooling.
- **No tool calls `confirm=true` on its own**. The `confirm` is the caller's decision, full stop.

## 10. Adding a tool — checklist

1. Pick the class (Read / Write / Destructive / Config / Batch). If unsure, ask — the class shapes the gating contract.
2. Write the function with the canonical signature pattern (see existing tools).
3. Wrap the underlying call in `try / except t.error as e: return _err(e)`.
4. If gated: `if not confirm: return _needs_confirm(...)` with every meaningful argument.
5. Return the success envelope `{ok: True, operation: "...", ...}` or use `_err()`.
6. Add a corresponding test in `tests/` mocking `timescape` — at minimum, verify the no-confirm path returns the preview and does not call the binding.
7. Update the README's tool table and (if you've added a new tool class) this document.

## Appendix B. Pre-publish compliance checklist

Use this checklist before publishing deck slides, demo scripts, research docs, mockups, customer-facing collateral, or MCP changes. Section 0 is the binding rule; this appendix is the working review pass that catches violations before they leave the repo.

1. Does every data claim identify whether it is public, synthetic, customer-owned, or internal?
2. Does any example imply access to another client's data, another tenant's data, or a Xenomorph-internal system?
3. Does any DCO savings figure name the baseline, time window, cost source, and assumptions?
4. Are NMVC internal commercial views, diligence material, investment thesis, debt/refinancing context, and private portfolio commentary excluded?
5. Does the artifact preserve the rule: build atop Xenomorph, never modify Xenomorph code?
6. Are write/destructive MCP paths described as confirm-gated, with four-eyes approval planned for destructive operations?
7. Does the artifact describe the actual MCP tool surface rather than imply that AI can do anything in TimeScape?
8. If demo data is used, is it clearly synthetic, anonymised with permission, or customer-owned in the calling tenant?
9. Does any dashboard, mockup, or export make the tenant boundary visible enough for a buyer, compliance lead, or auditor to understand?
10. If an unresolved Brian / Keith question affects an output, is the dependency called out instead of hidden?
