# v1.5 DCO Visibility — tool surface contract

> Concrete signatures, return shapes, and SQL view dependencies for the five proposed DCO Visibility tools. Written so that when Brian answers the four open questions (cost reference, desk dimension, substitution-success semantics, demo data), we can implement same-day.
>
> Reads from: [`DCO_RECON.md`](DCO_RECON.md) (schema), [`KEITH_NEEDS_TODAY.md`](KEITH_NEEDS_TODAY.md) (compliance non-negotiables), [`../CONTRACT.md`](../CONTRACT.md) (safety contract & §0 Tenancy).

---

## Class assignment

All five v1.5 tools are **read-class** under the existing safety contract: execute unconditionally, no `confirm` gating. None mutate TimeScape state. None touch other tenants' data (CONTRACT §0). None expose cost or savings data without an explicit, named baseline.

## Shared parameters

Several tools take a window or baseline. Defined once here.

### `Window`

```ts
type Window = {
  // ISO 8601 dates. End is exclusive.
  start: string;   // "2026-04-11"
  end:   string;   // "2026-05-11"
} | {
  // Or a relative shorthand the server resolves on the host's local clock.
  last: "7d" | "30d" | "90d" | "ytd" | "mtd";
}
```

### `BaselineMethod`

Open until Brian answers Q1 from the recon. Three candidate methods preserve as named string literals so the answer becomes a tool param, not a schema break:

```ts
type BaselineMethod =
  | "bloomberg_tier_pricing"   // raw BBG DL contract rates, looked up against ActiveRequestVendorPrograms × volume
  | "pre_dco_historical"       // customer's own pre-DCO spend baseline, requires a configured "from-date"
  | "contracted_rate_table"    // a static per-record price ref the customer provides
```

Tools that depend on this take an optional `baselineMethod` arg; when omitted, the server returns the savings *structure* (counts, ratios, vendor mix) but with `estimated_savings_usd: null` and an `unmet_dependency: "baselineMethod"` field in the response. This lets the deck mockup show shape without committing to numbers.

---

## Tool 1 — `dco_savings_summary`

### Signature

```python
@mcp.tool()
def dco_savings_summary(
    window: dict,                       # Window
    baselineMethod: str | None = None,  # BaselineMethod
) -> dict: ...
```

### Return shape

```jsonc
{
  "ok": true,
  "window": { "start": "2026-04-11", "end": "2026-05-11" },
  "tenant_scope": "customer_only",     // CONTRACT §0 hard rail
  "totals": {
    "bloomberg_requests": 12847,        // count from BloombergRequests
    "dco_served": 8103,                 // DataLoaded=1 and RequestError=0
    "substituted": 3211,                // joined with RequestSubstitutes
    "direct_passthrough": 1533,         // requests that bypassed DCO
    "failed": 0                         // RequestError=1
  },
  "estimated_savings": {
    "amount": 47290.00,                 // null if baselineMethod omitted
    "currency": "USD",
    "method": "bloomberg_tier_pricing", // echo of input
    "baseline_window": "2026-04-11..2026-05-11"
  },
  "unmet_dependencies": []              // ["baselineMethod"] if amount is null
}
```

### SQL views

- `BloombergRequests` — primary activity log.
- `RequestSubstitutes` — joined on `PackageRunID` / `ItemRefID` to count substituted requests.
- `ActiveRequestVendorPrograms` — for tier pricing lookup when `baselineMethod="bloomberg_tier_pricing"`.

### Compliance posture

- Tenant-scoped by SQL connection (Integrated Auth = customer identity).
- No peer comparison.
- `estimated_savings.method` always echoed in the response so the figure is never decontextualised.
- `null`-amount fallback when baseline is unspecified — refuses to invent savings.

---

## Tool 2 — `dco_savings_by_desk`

### Signature

```python
@mcp.tool()
def dco_savings_by_desk(
    window: dict,                       # Window
    baselineMethod: str | None = None,  # BaselineMethod
) -> dict: ...
```

### Return shape

```jsonc
{
  "ok": true,
  "window": { ... },
  "tenant_scope": "customer_only",
  "desk_dimension": "EntityProcessID",  // see open Q below
  "rows": [
    { "desk_id": "EQ-RATES",  "desk_label": "Equity Rates",
      "bloomberg_requests": 4_281, "dco_served": 2_847, "substituted": 1_201,
      "estimated_savings": { "amount": 18_410.00, "currency": "USD" } },
    { "desk_id": "FX",        "desk_label": "FX",
      "bloomberg_requests": 3_182, "dco_served": 1_904, "substituted":   823,
      "estimated_savings": { "amount": 10_205.00, "currency": "USD" } },
    // ...
  ],
  "unmet_dependencies": []              // ["baselineMethod"] | ["desk_dimension_unconfirmed"]
}
```

### SQL views

- `BloombergRequests` JOIN `EntityRequestMessages` (on `EntityRequestMessageID`-equivalent) JOIN `EntityProcesses` on `EntityProcessID`.
- Group by `EntityProcessID` for `desk_id`; `EntityProcesses.Name` (assumed) for `desk_label`.

### Compliance posture

- Org dimension is the customer's own configured entity hierarchy (no Xeno-internal hierarchy bleeds in).
- If `EntityProcessID` turns out NOT to map to "desk" (Brian's call), the response carries `desk_dimension: "<actual-field>"` and `unmet_dependencies: ["desk_dimension_unconfirmed"]` until renamed.

---

## Tool 3 — `dco_optimisation_decisions`

### Signature

```python
@mcp.tool()
def dco_optimisation_decisions(
    window: dict,                                 # Window
    filterDisposition: str | None = None,         # "dco_served" | "substituted" | "direct_passthrough" | "failed"
    limit: int = 100,                             # cap at 1000
) -> dict: ...
```

### Return shape

```jsonc
{
  "ok": true,
  "window": { ... },
  "tenant_scope": "customer_only",
  "filter": { "disposition": null, "limit": 100 },
  "rows": [
    {
      "bloomberg_request_id": 91842,
      "timestamp": "2026-05-10T09:42:11+00:00",
      "request_type": "BVAL",
      "asset_class": "Equity",
      "disposition": "substituted",
      "substitution_rule": {
        "destination_category": "Internal",
        "destination_code_type": "Reuters",
        "destination_data_source": "Internal_NightlyCache",
        "fields_query": "Close, High, Low"
      },
      "identifiers": [
        { "identifier": "BP.L", "identifier_type": "Reuters" }
      ],
      "outcome": { "data_loaded": true, "had_error": false }
    },
    // ...
  ]
}
```

### SQL views

- `BloombergRequests` (one row per request, w/ bit flags for disposition).
- `RequestSubstitutes` (LEFT JOIN to populate `substitution_rule` if a sub fired).
- `BloombergRequestIdentifiers` (one-to-many for the `identifiers` array).

### Compliance posture

- `identifiers` shows the actual securities the customer asked for — already their data, no leak.
- `disposition` is derived from public bit flags; no internal Xeno scoring leaked.

### Notes

- Most useful tool for "show me an example of a recent saving" in a demo — feeds the BK script's Moment 5/6 substitute.
- `filterDisposition="substituted"` gives the cleanest narrative thread.

---

## Tool 4 — `vendor_entitlement_audit`

### Signature

```python
@mcp.tool()
def vendor_entitlement_audit(
    vendor: str | None = None,    # "Bloomberg" | "Reuters" | None = all
) -> dict: ...
```

### Return shape

```jsonc
{
  "ok": true,
  "tenant_scope": "customer_only",
  "vendors": [
    {
      "vendor": "Bloomberg",
      "active_accounts": [
        {
          "account_id": "BBG-XYZ123",
          "programs": ["BVAL", "BVAL_FixedIncome", "BPipe"],
          "encryption": "des",
          "delivery": "SFTP",
          "redundancy_note": "Two programs cover same instrument universe — see ProgramConfigs"
        }
      ]
    },
    { "vendor": "Reuters", "active_accounts": [/* ... */] }
  ]
}
```

### SQL views

- `ActiveRequestVendors`
- `ActiveRequestVendorPrograms`
- `ActiveEntityRequestVendorConfigs` / `ActiveEntityRequestVendorParameters` for the per-account config.

### Compliance posture

- Configuration *metadata only*. No request bodies, no usage data. The customer already knows their own vendor accounts; this view just makes it inspectable through the MCP.
- No cross-vendor cost comparison (that's Tool 5).

---

## Tool 5 — `vendor_cost_summary`

### Signature

```python
@mcp.tool()
def vendor_cost_summary(
    window: dict,                       # Window
    baselineMethod: str | None = None,  # BaselineMethod
    groupBy: str = "vendor",            # "vendor" | "asset_class" | "vendor_x_asset_class"
) -> dict: ...
```

### Return shape

```jsonc
{
  "ok": true,
  "window": { ... },
  "tenant_scope": "customer_only",
  "group_by": "vendor",
  "rows": [
    { "vendor": "Bloomberg", "request_count": 12_847, "cost_with_dco": 9_310.00, "cost_without_dco": 56_600.00, "currency": "USD" },
    { "vendor": "Reuters",   "request_count":  4_122, "cost_with_dco": 4_122.00, "cost_without_dco":  4_122.00, "currency": "USD" }
  ],
  "estimated_savings": {
    "amount": 47290.00,
    "currency": "USD",
    "method": "bloomberg_tier_pricing"
  },
  "unmet_dependencies": []
}
```

### SQL views

- `BloombergRequests` + `ReutersRequests_fg1` (combined) for activity.
- Pricing source as per `baselineMethod`.

### Compliance posture

- Same baseline discipline as Tool 1: `null`-amount and `unmet_dependencies` when method unspecified.
- `cost_with_dco` and `cost_without_dco` shown side-by-side — explicit so a CFO can read the comparison without inference.

---

## Implementation order (post-Brian-answers)

| Day | Work |
|---|---|
| **Day 1 AM** | Wire `vendor_entitlement_audit` first — read-only metadata, no baseline dependency, low risk, high signal-value. |
| **Day 1 PM** | Wire `dco_optimisation_decisions` — drives Moment 5/6 of the demo without needing a cost reference. |
| **Day 2 AM** | Wire `dco_savings_summary` and `vendor_cost_summary` together (they share most plumbing). Configurable `baselineMethod` lets Brian answer Q1 by setting a config rather than changing code. |
| **Day 2 PM** | Wire `dco_savings_by_desk` once Brian confirms the desk dimension. |
| **Day 3** | Cross-platform tests (with `timescape` stub returning shaped fake data), README updates, tag `v1.5.0`. |

Three days bench-time from greenlight to release. Two days if the desk-dimension question stays open and we ship four of five.

---

## Open questions — gating which tools

| Tool | Question | Without answer |
|---|---|---|
| `dco_savings_summary` | Q1: cost reference data | Returns counts + ratios; `estimated_savings.amount = null`, `unmet_dependencies = ["baselineMethod"]` |
| `dco_savings_by_desk` | Q1 + Q2 (desk dimension) | Returns activity by `EntityProcessID` with a flag; null savings |
| `dco_optimisation_decisions` | Q3 (substitution-success semantics) — minor | Ships with current best-effort interpretation; flag added to row when disposition is ambiguous |
| `vendor_entitlement_audit` | None | Ships day 1 |
| `vendor_cost_summary` | Q1 | Same as `dco_savings_summary`: structure-only without numbers |

So **`vendor_entitlement_audit` and `dco_optimisation_decisions` ship day-1 with zero blockers**. The other three ship with placeholder numerics until Brian / Keith hand us a baseline method.

---

## What this enables, in one sentence

The deck mockup of the v1.5 surface (slide 10) can render against this contract today using synthetic data — and when the open questions resolve, the live versions slot into the same response shape with no client-side change.
