# DCO recon findings (v1.5 prep)

> Outcome of the four-question DCO Visibility recon plan, captured 2026-05-11 from the Xeno-issued laptop (`XSL18LTOP15D`). Sources are noted inline. **This is recon, not a tool spec** — v1.5 tool surface follows from but does not appear in this doc.

## Q1 — Does `timescape.pyd` (or any SDK/Examples surface) expose DCO?

**No.** The CPython API surface documented in `APIs/CPython/v3.13/Examples/` covers data CRUD only (`query` / `itemQuery` / `saveItem` / `saveProp` / `saveSeries` / `delete*` / `workspaceGet|Set`). The C API (`APIs/C API/Inc/xenoc.h`) and `.NET API` assemblies likewise expose data access, not DCO state. Grepping the entire `APIs, SDKs, Examples` tree for `DCO`, `Licen*`, `Vendor*`, `CostOptim`, `Entitle*`, `Saving*`, `Optimi*`, `Bloomberg`, `Reuters` returns:

- False positives from `XcDatabaseAddCodeType` and `DownloadFlags.LoadCodes` (string match `DCO` inside `AddCodeType` / `LoadCodes`).
- `QL+, Analytics and Data Examples/Other Data Sources/Reuters/` — analyst-facing sample workbook, not a programmer surface.
- `Task Examples/Download Tasks/Bloomberg/` and `Task Examples/Download Tasks/Reuters/` — `.tdf` task templates for batch downloads.

**Implication:** DCO is not part of the public programmer surface. Any v1.5 tool that surfaces DCO state must read directly from the underlying SQL Server backend (`TimeScapeProcessManagement`) or wrap one of the DCO/EDM+ admin services described below.

## Q2 — XTDCO* siblings + EDM+ binaries: which expose a query CLI / REST / OData?

Inventory under `C:\Program Files\Xenomorph TimeScape\` (and the x86 sibling, identical naming):

| Binary | Role | Surface |
|---|---|---|
| `TimeScape DCO Monitor Service\XTDCOMonitorService.exe` (174 KB) | Primary/Secondary monitor pair: intercepts client data-request files, hands DCO-compliant requests to EDM+ File Processing for optimisation, falls back to direct-to-vendor for non-compliant ones | **Windows service** (or `cmdline` for debug). No external query API. State persists to `TimeScapeProcessManagement` SQL DB + filesystem under `{DCOMonitorRoot}\{DataVendorAccountId}\{Done|Failed|Processing|Response|TimedOut}\` |
| `TimeScape EDM+ File Processing Service\Xenomorph.TimeScape.EdmFileProcessingService.exe` | Runs DCO logic on requests handed off from DCO Monitor | Windows service. IPC on `net.tcp://localhost:59798/FileProcessingServiceStatus` (health check only — see `XTDCOMonitorService.config` template). No query API |
| `TimeScape EDM+ Service\Xenomorph.TimeScape.EdmService.exe` + `xtedm.exe` | Rules / workflow engine (the "EDM+" core) | Windows service; rule import/export via `XdbRuleExport.exe` / `XdbRuleImport.exe` (file-based) |
| `TimeScape EDM+ Messaging Service\EDMMessageConsumer.exe` + `Xenomorph.TimeScape.Messaging.Service.exe` | Async messaging between EDM+ components | Windows service. No external surface |
| `TimeScape DCO Monitor Service\` includes `XTDCOMonitorService_ReadMe.txt` | **Full operational doc for DCO** — install steps, config keys, folder structure, primary/secondary handoff logic, encryption (Bloomberg DES), regex filters for compliance | Plain text; key source-of-truth for v1.5 design (see "Operational model" below) |
| `Program\XTTABBDataLicense.dll` (274 KB) | Integration with Bloomberg Data License (TABB-standard) | Native DLL, not directly callable from external code |

**Bottom line for Q2:** the DCO/EDM+ binaries are all internal services with no public query/REST/OData surface. The wrap target is therefore not these binaries but the **SQL Server state they all persist into** plus the **filesystem folders** they all operate on.

## Q3 — SQL Server schema introspection on `TimeScapeProcessManagement`

**Connection:** `Server=localhost; Database=TimeScapeProcessManagement; Integrated Security=True;` (Kerberos / AD). On this box: SQL Server 2022 Developer Edition (MSSQL16, instance `MSSQLSERVER`). 

Other databases on the same instance, all owned by TimeScape: `GOLD`, `SILVER`, `RAW`, `PUBGOLD`, `PUBSILVER` (data-tier convention — quality grades plus public-tier variants) plus the standard `master/tempdb/model/msdb/SSISDB`.

**`TimeScapeProcessManagement` — DCO-relevant tables (15):**

| Table | Purpose |
|---|---|
| `ActiveRequestVendors` | Master list of active vendors (Bloomberg, Reuters). 2 rows on this dev box |
| `ActiveRequestVendorPrograms` | Bloomberg programs supported (maps to `DCOSupportedBloombergPrograms` in DCO Monitor config) |
| `ActiveRequestVendorConfigs` / `ActiveRequestVendorParameters` / `ActiveEntityRequestVendorConfigs` / `ActiveEntityRequestVendorParameters` | Per-vendor and per-entity (organisational dimension — probably what corresponds to "desk") config + params |
| `ActiveRequestVendorErrors` | Error log keyed by request |
| `ActiveBloombergAllQuotes` | Live Bloomberg quote state |
| `BloombergRequests_fg1` (view: `BloombergRequests`) | **Request-level log of every Bloomberg API call** — see schema below. Empty on this dev box |
| `BloombergRequestIdentifiers_fg1` (view: `BloombergRequestIdentifiers`) | Securities-level breakdown of each request |
| `BloombergRequestIdentifierGroups_fg1` / `BloombergRequestIdentifierGroupMembers_fg1` | Logical groupings of identifiers |
| `ReutersRequests_fg1` / `ReutersTempDataTables_fg1` / `ActiveReutersTempData` | Reuters analogues |

(The `_fg1` suffix is SQL Server filegroup partitioning; views with the same name minus the suffix are the read API.)

**`TimeScapeProcessManagement` — DCO-relevant views (27 total — highlights):**

- **`BloombergRequests`** (18 cols): `ExecID`, `BloombergRequestID`, `PackageRunID`, `RuleItemRefID`, `RequestType`, `AssetClass`, `TimeStamp`, `RequestFileName`, `ReplyFileName`, `RequestUploaded`, `RequestUploadFailed`, `RequestError`, `ReplyDownloaded`, `ReplyDecrypted`, `DataLoaded`, `ReplyFileIsZipped`, `SplitFileCount`, `SplitFileProcessed`. **This is the savings goldmine** — every row is one outbound Bloomberg API call. Combination of the bit flags tells us whether DCO completed (`DataLoaded=1`) or fell through (`RequestError=1`).
- **`RequestSubstitutes`** (12 cols): `ExecID`, `PackageRunID`, `ItemRefID`, `InstrumentsQuery`, `FieldsQuery`, `ParametersQuery`, `DestinationCategory`, `DestinationCodeType`, `DestinationDataSource`, `BloombergSaveDate`, `BloombergSaveDateColumn`, `BloombergSaveDateFormat`. **This is the "alternative-vendor" substitution rule** — when a request can be served from a different DataSource instead of hitting Bloomberg, this rule fires. The savings claim from Keith's framing materialises here.
- **`BloombergRequestIdentifiers`** (10 cols): `Identifier`, `IdentifierType`, `PricingSource`, plus date range + execution linkage. Joinable to `BloombergRequests` via `ExecID` / `PackageRunID`.
- **`RequestQueue`** / **`RequestQueueItems`** / **`RequestRules`** / **`RequestUniverse`** / **`RequestCalcs`** / **`RequestLinks`** — workflow primitives.
- **`EntityProcesses`** / **`EntityProcessRuns`** / **`EntityRequestMessages`** / **`EntityRequestMessageParameters`** / **`EntityRequestMessageItemRefs`** / **`EntityWorkflowRunEntityProcessRuns`** — the entity/process/workflow model (where "Entity" is a TimeScape org-dimension — probably maps to "desk" or "client unit"; needs Brian to confirm).
- **`ProcessActions`** + Types + Links — workflow action graph.
- **`PackageRulesProcessLog`** / **`ProcessManagementErrorLog`** / **`ProcessManagementPackagesErrorLog`** — audit trails.

## Operational model (synthesised from `XTDCOMonitorService_ReadMe.txt`)

Per the README at `C:\Program Files\Xenomorph TimeScape\TimeScape DCO Monitor Service\XTDCOMonitorService_ReadMe.txt`:

1. **Client drops a request file** at `{ClientRequestResponseRoot}` (FILE) or an SFTP site (SFTP). One client account at a time on this dev box (`{DataVendorAccountId}`).
2. **DCO Monitor (Primary)** picks it up, moves to `{DCOMonitorRoot}\{DataVendorAccountId}\Processing\PRIMARY\`.
3. Monitor checks **DCO compliance** against two regex files:
   - `{SupportedSecurityRegExFile}` — identifier formats DCO can optimise.
   - `{UnsupportedHeaderOptionsRegExFile}` — header options DCO can't handle.
4. **DCO-compliant** → hand off to EDM+ File Processing Service via `net.tcp://localhost:59798/...` → DCO runs the request, applies `RequestSubstitutes` rules where possible, returns substituted data **OR** the lower-cost DCO call to Bloomberg.
5. **Non-DCO-compliant** → request goes direct to Bloomberg Data License (no savings, but email notification fires from `{EmailRequestNotDCOCompliantSubject}` config).
6. **Secondary monitor** is failover: if Primary, EDM+ FPS, or DCO itself is down, Secondary sends direct to Bloomberg.
7. Replies land in `{DCOMonitorRoot}\{DataVendorAccountId}\Response\`, get decrypted (Bloomberg DES for old SFTP-pre accounts), data loaded into TimeScape, file moved to `Done` (or `Failed` / `TimedOut`).
8. **Encryption keys** per Data Vendor live in `TimeScapeProcessManagement`.

## What the v1.5 surface can claim, given the schema

(For xenobridgeclaude's tool design — not committing to names here.)

| Proposed v1.5 tool | Data needed | Source | Confidence |
|---|---|---|---|
| `dco_savings_summary` | request count + outcome bit-flag aggregate over a window, with per-request cost reference | `BloombergRequests` (count) + cost reference (TBD — see open Qs) | High on activity, low on cost dimension |
| `dco_savings_by_desk` | activity grouped by entity/desk dimension | `EntityProcesses` join through `EntityRequestMessages` to `BloombergRequests` | Medium — entity dimension needs Brian to confirm "desk" semantics |
| `dco_optimisation_decisions` | per-request disposition: DCO-served / substituted / direct-to-Bloomberg | `BloombergRequests` LEFT JOIN `RequestSubstitutes` on shared `PackageRunID`/`ItemRefID` | High |
| `vendor_entitlement_audit` | which vendors / programs / accounts a client is entitled to | `ActiveRequestVendors` + `ActiveEntityRequestVendorConfigs` + `ActiveEntityRequestVendorParameters` | High |
| `vendor_cost_summary` | spend per vendor over a window | request counts × cost reference; structural data fine, cost reference open | Medium — same blocker as `dco_savings_summary` |

## Open questions for Brian (to enable v1.5 confidently)

1. **Cost reference:** where is the per-request / per-record cost number stored? Bloomberg DL has tier pricing; the schema here doesn't obviously hold price per `RequestType`/`AssetClass`. Is it (a) in a static config file we should consume, (b) in a different DB we haven't found, (c) computed externally by the client and held in their CRM?

2. **"Desk" / org dimension semantics:** is `EntityProcesses.EntityProcessID` the right grouping for what business calls "desk", or is there a higher-level concept (`Client`, `BusinessUnit`) elsewhere in the schema?

3. **Substitution success rate:** when `RequestSubstitutes` rules engage, do they always succeed, or is there a fallback path that's not visible in the views I've seen? (I.e. is `DataLoaded=1 AND a matching RequestSubstitute row` a reliable "savings event"?)

4. **Live-data ergonomics:** Is the Xeno-issued laptop's `TimeScapeProcessManagement` ever populated with synthetic activity for a demo, or do we need to stand up a test workload to show DCO Visibility in action?

## Dev/test caveat

All `Bloomberg*` / `Reuters*` / `Request*` / `Entity*` tables on this dev box are **empty** (0 rows) except `ActiveRequestVendors` (2 rows). Sufficient for v1.5 schema design and stubbing; insufficient for live demo. Need either (a) synthetic dataset, (b) anonymised production extract from a client deployment, or (c) screenshots/figures from a real Xeno reference customer with permission.

## What this enables, succinctly

The v1.5 tool surface is implementable today against this schema. The shape of "savings legibility" — *how* we present `RequestSubstitutes` engagement as a $-figure — is gated on cost reference data we don't yet have. **That's the right question to put in front of Keith** (Keith owns the commercial framing; he knows whether cost-per-record reference data is something Xeno already has, can compute, or should be sourced from clients' own tier agreements).
