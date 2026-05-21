# Persistence — Decision Doc for fresh-ANT Migration Step 4

**Author:** researchant (Claude best-of-the-best research agent)
**Date:** 2026-05-12
**Timebox:** 30 min scan, read-only
**Scope:** Recommend the persistence layer for fresh-ANT. Compare lift-v3 vs bun:sqlite vs Turso libsql vs JSONL event log. No code written.
**Audience:** JWPK + codex2 (implementer)

---

## TL;DR

**Recommendation: Rebuild on `bun:sqlite` (Option B), gated on a 30-second FTS5-on-macOS probe slice.**

If the FTS5 probe passes (highly likely — Bun's SQLite has FTS5 on Linux since 2023, build configs are typically shared across platforms), `bun:sqlite` is the right call for the same category of reasons the PTY doc gave for `Bun.Terminal`: it removes the entire native-module / NODE_MODULE_VERSION bug class that has already caused at least one silent v3 server outage ([[feedback_better_sqlite3_abi_mismatch]]).

If the FTS5 probe fails on macOS, fallback recommendation is `@tursodatabase/database` (Turso's local embedded driver, libSQL-based). It works in Bun via N-API, ships FTS5 by default, and keeps the door open to push/pull sync in future.

JSONL event log is rejected for the primary store, but flagged as the right call for a *secondary* write-ahead audit log (already used in v3 for open-slide manifest [[project_open_slide_manifest]]).

---

## Context — what v3 has today

- File: `src/lib/server/db.ts` — **2061 lines** (significantly larger than pty-daemon)
- File: `src/lib/server/agent-event-bus.ts` — second consumer of the same DB
- Dependency: `better-sqlite3` (native module, Node ABI-locked)
- Schema scale: **92 CREATE TABLE/INDEX/VIRTUAL TABLE statements**
- FTS5 usage: **4 virtual tables** — `messages_fts`, `terminal_text_fts`, `memories_fts`, `command_events_fts`. Load-bearing for search across rooms, terminal scrollback, memory recall, and command-event index.
- JSON1 usage: **0 SQL-level json_* calls** (grepped). All JSON serialisation happens in JS before INSERT. So JSON1 is nice-to-have, not load-bearing.
- WAL mode: standard SQLite WAL is in use (typical for v3-style write-heavy workloads).
- Singleton pattern: `globalThis.__antDb` via [[feedback_globalthis_pattern]] — survives HMR.

### Known v3 persistence incidents

| Incident | Root layer | Cite |
|---|---|---|
| ABI-DLOPEN crash on better-sqlite3 NODE_MODULE_VERSION mismatch | Native binding rebuilt against wrong Node version | [[feedback_better_sqlite3_abi_mismatch]] |
| Worktree drift — npm install in a worktree rebuilds native deps against active shell Node | Same root, different trigger | [[feedback_better_sqlite3_abi_mismatch]] |
| Migration script forgot to rebuild after Node upgrade | Same root, different trigger | (logs only) |

All three are bindings-layer, identical to the PTY native-module pattern. Same fix shape: remove the native binding.

---

## Options table

| # | Option | FTS5 | JSON1 | Bun-native | ABI risk | Sync story | Time-to-M0 |
|---|---|---|---|---|---|---|---|
| A | Lift v3 (better-sqlite3 + Node 20.19.4 lock) | Yes (bundled) | Yes | No (N-API + ABI lock) | High (recurring) | Manual replication | 2-3 days |
| B | `bun:sqlite` native | Likely (probe needed) | Likely | Yes | None | Manual replication | 4-5 days |
| C | Turso `@tursodatabase/database` (libSQL embedded) | Yes (libSQL = SQLite fork with extras) | Yes | N-API, works in Bun | None for the driver itself | Built-in push/pull via `@tursodatabase/sync` | 5-7 days |
| D | JSONL append-only event log + in-memory state projection | No SQL | N/A | Yes (no deps) | None | Trivially copyable | 7-10 days (no SQL query primitives, rebuild every projection) |

**Note:** Drizzle ORM supports all of A/B/C as drivers via the same query surface. If fresh-ANT picks up Drizzle, the bindings choice is reversible later. If fresh-ANT stays driver-direct (v3 pattern), switching is per-call edits.

---

## Why Option B wins (conditionally)

### 1. Same ABI-class elimination as the PTY decision

`bun:sqlite` is built into the Bun runtime. There is no `node_modules/better-sqlite3/build/Release/better_sqlite3.node` to rebuild. The exact failure mode logged in [[feedback_better_sqlite3_abi_mismatch]] — server logs "running at 6458" then crashes on db.ts:41 with NODE_MODULE_VERSION mismatch — cannot occur. This is the same category-shift argument as Option C for PTY: pull a recurring incident class to zero.

### 2. Performance — Bun claims 3-6x faster than better-sqlite3

From the [bun:sqlite docs](https://bun.com/docs/api/sqlite): *"the fastest performance of any SQLite driver for JavaScript… 3-6x faster than better-sqlite3"*. Even if real-world is 1.5-2x, it's a free win.

Marketing claims need salt — but the underlying mechanism (zero-cost FFI via JavaScriptCore bindings instead of N-API marshalling) is real, so SOME improvement is plausible. The doc-reader's job is to demand the FTS5 probe verify both correctness AND maintained-performance under fresh-ANT's actual queries before locking in.

### 3. Schema lifts unchanged

92 CREATE statements is a lot, but they are SQL. SQLite is SQLite — schema migrates by running the same DDL against the new driver. `bun:sqlite`'s API surface (prepared statements, transactions, parameter binding) is structurally identical to `better-sqlite3`'s. Per-call edits are mechanical: import default from `better-sqlite3` → named import from `bun:sqlite`.

### 4. Native API matches Bun's preferred runtime

fresh-ANT already requires `bun >=1.3.13` (verified). No version bump needed. Removes the implicit need for `nvm` and `.nvmrc` discipline that v3 needs.

### 5. Smaller LOC budget — 9-year-old-readable

v3's db.ts is 2061 lines. Much of that is correct-by-construction schema and queries that lift directly. But ~150-200 lines are ABI guards, migration helpers, and singleton-survival-across-HMR helpers ([[feedback_globalthis_pattern]]) — some of which simplify because `bun:sqlite` is a runtime singleton anyway. Realistic fresh-ANT target: 1500-1700 lines, split across:
- `db-init.ts` schema + pragmas + WAL setup (~250)
- `db-singleton.ts` globalThis pattern (~50)
- `db-queries-room.ts` chat/rooms (~250)
- `db-queries-terminal.ts` terminals + command events (~250)
- `db-queries-memory.ts` memories + FTS5 (~250)
- `db-queries-misc.ts` everything else (~400-500)

Each file under the 260-line 9-year-old-readable cap.

---

## Why NOT Option C (Turso) — for now

Turso's libSQL is technically excellent and has *more* capability than `bun:sqlite` (built-in sync, vector search, multi-DB). It works in Bun via N-API. FTS5 is included.

But: the directive memory says *"fresh-ANT runs on Mac currently Mac mini M4 Pro, Bun preferred but not required"*. There is no current multi-machine requirement. Adding N-API back when Bun has a native option would re-introduce — at smaller scale — the binding-layer dependency that the PTY doc spent effort removing.

**When to flip to Option C:** if JWPK confirms iPhone/iPad local-data-with-sync is in scope for an M2/M3 milestone, then Turso's `@tursodatabase/sync` is the right pattern *and* worth eating the N-API cost. Until then, `bun:sqlite` is the leaner choice.

This is Open Q1 below.

---

## Why NOT Option D (JSONL) — for the primary store

JSONL append-only is a great fit for:
- Audit logs / write-ahead logs (already in v3: open-slide manifest jsonl per [[project_open_slide_manifest]])
- Cross-tool readable trails (any agent can cat | jq)
- Trivially copyable / version-controllable

But fresh-ANT needs:
- Full-text search across messages/terminals/memories (FTS5)
- Indexed queries (room-by-id, terminal-by-id, recent-N-by-timestamp)
- Joins (memberships × rooms × messages)

A JSONL-only store would re-implement an in-memory database in TypeScript to serve these queries. That is *more* code than the SQLite layer it replaces, and *much* harder to keep correct across reloads.

**Where JSONL belongs in fresh-ANT:** as a sidecar audit log for high-trust events (admin token changes, plan_milestone closures, agent identity registrations) — already the v3 pattern for the open-slide manifest. Not the primary store.

---

## Do-not-use

| Choice | Reason |
|---|---|
| **`node:sqlite` (Node 23+ built-in)** | Ships without SQLITE_ENABLE_FTS5. v3 uses FTS5 in 4 places. Confirmed via Node sqlite issue tracker (FTS5-missing reports). |
| **Drizzle on top of `bun:sqlite` for M0** | Drizzle is a fine future move and works on all three drivers. But adding an ORM in the same slice as a driver-swap doubles the change-surface. Drizzle adoption is a separate research-evaluate slice. |
| **Prisma** | Heavyweight, codegen step in the build chain, Node-first. Cuts against 9-year-old-readable. |
| **In-process SQLite via WASM (sql.js)** | No filesystem persistence without manual export/import on every write. Order-of-magnitude slower for the write-heavy workload (terminal scrollback, FTS5 indexes). |
| **Lift v3 better-sqlite3 as-is (Option A)** | Carries the recurring NODE_MODULE_VERSION incident class. Same reasoning as Option A in the PTY doc. |

---

## Primary sources

- [Bun SQLite docs](https://bun.com/docs/api/sqlite) — feature surface, prepared statements, transactions, WAL
- [Bun SQLite API reference](https://bun.com/reference/bun/sqlite) — type signatures
- [Turso quickstart](https://docs.turso.tech/sdk/ts/quickstart) — three packages (`@tursodatabase/database` local, `/serverless` remote, `/sync` embedded replica)
- [better-sqlite3 repo (WiseLibs)](https://github.com/WiseLibs/better-sqlite3) — v12.10.0 active as of May 2026
- [SQLite FTS5 docs](https://www.sqlite.org/fts5.html) — BM25 ranking, virtual table syntax (unchanged across drivers)

---

## Open questions for JWPK

### Q1. Multi-machine sync — in scope for M0/M1?

If fresh-ANT must be accessible from iPad Pro / iPhone with local-data offline-tolerant reads, then Turso embedded replica becomes a much stronger candidate. If single-machine Mac mini M4 Pro is the operational model, `bun:sqlite` is leaner.

**Researchant view:** based on memory ([[project_ant_migration_endpoint_2026_05_12]] step 1 = fresh-ant-live-at-Tailscale), the *current* model is one Mac serving everywhere via Tailscale, not local replicas. So `bun:sqlite`. But if multi-device shipping is in M1/M2, plan the Turso path now.

### Q2. Drizzle ORM — yes/no?

Drizzle supports `bun:sqlite`, `better-sqlite3`, and `libSQL` via swappable drivers. If JWPK wants the persistence-driver choice to be reversible later without per-call edits, adopt Drizzle. Cost: extra build step, slightly slower writes, learning curve for the team.

**Researchant view:** ship without Drizzle in fresh-ANT M0. The driver-direct pattern from v3 is fine and 9-year-old-readable. If Q1 later flips us to Turso, the migration is mechanical (similar API). Defer Drizzle until there's a real ORM-shaped problem.

### Q3. Migration from v3 SQLite file — fresh-start or copy?

v3 has a live SQLite database with chatrooms, messages, terminals, memories. fresh-ANT can either:
- Start fresh — no data migration. Simplest.
- Run a copy/migrate script — preserves history.

**Researchant view:** since v3 stays running until fresh-ANT proves out, start fresh. Migration script is a separate slice if/when fresh-ANT becomes primary.

### Q4. FTS5-on-macOS probe — who runs it and when?

This is the conditional that gates the recommendation. The probe is the smallest possible test:
1. Open a `bun:sqlite` in-memory database.
2. Create a virtual table using the `fts5` module on a single text column.
3. Insert one row and run a MATCH query.
4. Expect the row back.

If this runs cleanly on Mac mini M4 Pro under bun 1.3.13+, Option B is unlocked. If it throws "no such module: fts5", fall back to Option C.

**Researchant view:** this is a 30-second test, not even a 30-minute slice. codex2 can run it as part of the first implementation slice. If it fails, ping researchant for a re-scope.

Note: codex2 has already claimed an analogous `pty-bun-smoke-probe` for the PTY decision — same probe-first pattern, same risk-of-fallback gating. That validates the contract shape.

---

## What I did NOT verify (timebox honesty)

- The exact SQLite version `bun:sqlite` bundles on Bun 1.3.13 on macOS arm64 — Bun's TS source doesn't expose `PRAGMA compile_options`, would need an actual probe.
- Whether `bun:sqlite` performance claim (3-6x vs better-sqlite3) holds for FTS5-heavy workloads specifically. Bun's benchmarks are for general SELECT/INSERT, not FTS5 queries.
- Whether `@tursodatabase/database` (libSQL local) works *cleanly* under Bun's N-API. The Turso docs do not call out Bun explicitly. Likely works (N-API is N-API) but unverified.
- Whether v3's 92 CREATE statements include any SQLite syntax that's SQLite-version-specific and might surprise on a different bundled version (e.g. RETURNING clause, IIF(), JSON_EXTRACT operator). The grep showed no `json_*` SQL functions but did not enumerate all DDL syntax variants.
- Whether `bun:sqlite` supports LOAD_EXTENSION for custom SQLite extensions if fresh-ANT later wants `sqlite-vec` or similar.

All are probe-able in <30 min each by codex2 during the FTS5-probe slice.

---

## Next step

If JWPK accepts Option B (conditional on FTS5 probe): codex2 scopes a 3-slice implementation lane:
1. FTS5-on-macOS probe slice — 30-second test, unlocks B or falls back to C.
2. Schema-lift slice — port the 92 CREATE statements + WAL pragma + globalThis singleton.
3. Driver-call rewrite slice — better-sqlite3 API → `bun:sqlite` API across all callers (mostly mechanical).

If JWPK flips to Option C (multi-machine sync becomes M1 scope): same 3-slice lane but slice 2 uses `@tursodatabase/database` instead, slice 3 sets up the optional sync hooks.

If JWPK wants more research: list specific questions and researchant takes another slice.

End of doc.
