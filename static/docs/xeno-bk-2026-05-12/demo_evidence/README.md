# Demo evidence

Frozen captures of `docs/demo_dry_run.py` against the live TimeScape v5.0 install + `xenomorph-mcp.exe` console script, retained as insurance for the live BK demo.

## When to use

- **Morning of the meeting** — re-run the dry-run script and confirm output matches the latest capture here. If anything changes (count of tools, BP.L price, v1.5 return shape), investigate before the meeting.
- **During the meeting if live ODBC glitches** — open the most recent capture in a side window and screen-share that. Same content as a live demo would produce, captured this morning. The narrative is unchanged.

## What's in each capture

Every file is the plain stdout of one full run of the dry-run script. Each contains:

- `[init]` line — confirms the MCP handshake worked (protocol `2025-11-25`)
- `[tools/list] count=21` — confirms the full tool surface is exposed
- Nine `=== M{n} — tools/call {tool} ===` blocks with the full JSON response
- Closing `PASS — all 9 dry-runnable moments executed cleanly`

The nine moments cover:

| ID | Tool | What it proves |
| --- | --- | --- |
| M1 | `version` | TimeScape reachable, MCP transport clean |
| M2 | `itemQuery` | Real read of `BP.L` from `XENO` returns `["BP.L", "BP", 508.0]` |
| M3 | `query` | Free-form QL+ returns `508.0` |
| M4 | `saveItem` (no confirm) | Write-gate fires (`needs_confirmation: true`) — safety contract is live |
| V1 | `vendor_entitlement_audit` | v1.5 live-data tool returns Bloomberg + Reuters with programs |
| V2 | `dco_optimisation_decisions` | v1.5 live-data tool returns `ok` with structure intact |
| V3 | `dco_savings_summary` | v1.5 structure-only — `amount: null` + `unmet_dependencies: ["baselineMethod"]` |
| V4 | `dco_savings_by_desk` | v1.5 structure-only — desk dimension unconfirmed flag set |
| V5 | `vendor_cost_summary` | v1.5 structure-only — vendor mix returned, cost null |

## What's NOT captured here

- `M5` (`saveItem` with `confirm=true`) — would mutate XENO. Live-demo only.
- `M6` (`deleteItem` with `confirm=true`) — same reason.

These are intentionally executed only in front of BK with explicit consent.

## How to re-capture

```cmd
:: from repo root, on the engagement laptop
set PYTHONIOENCODING=utf-8
.venv\Scripts\python.exe docs\demo_dry_run.py > docs\demo_evidence\dry_run_%date:~-4%-%date:~3,2%-%date:~0,2%.txt 2>NUL
```

Or run via `uv` if PATH-installed:

```cmd
set PYTHONIOENCODING=utf-8
uv run python docs\demo_dry_run.py > docs\demo_evidence\dry_run_morning_of.txt 2>NUL
```

If the run prints `FAIL`, do **not** start the demo — open the most recent `dry_run_*.txt` already in this folder for what the output *should* look like, then debug.
