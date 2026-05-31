# Archived terminal name tagging — design

**Date:** 2026-05-31
**Status:** Design (awaiting review)
**Author:** recoveryfixes session (@v4claude lane)

## Problem

Archived terminals (`status='archived'` — "tmux pane gone, kept for history")
keep their original `name`, which squats on the **global** `UNIQUE` constraint on
`terminals.name` (`src/lib/server/db.ts:47`). This produces two failures:

1. **Cannot create a genuinely new terminal** with that name — the archived row
   occupies the name in the unique index, so `upsertTerminal` can only `UPDATE`
   the old row (`terminalsStore.ts:249-261`), merging a fresh session into stale
   history rather than creating a distinct terminal.
2. **Reattach is ambiguous** — re-registering an archived name silently rebinds
   the archived row to live, with no chance to decide "revive the old one" vs
   "this is a fresh terminal that happens to reuse the name".

The collision *check* at registration only considers live terminals
(`getLiveTerminalByName`, filters `status='live'`, `terminalsStore.ts:470`), but
the *constraint* is global. That scope mismatch is the root cause.

## Goal

When a terminal is archived, **vacate its base name** by tagging it `[A] <base>`
(or `[A-2] <base>`, `[A-3] <base>` … when several archives share a base), so the
base name is immediately free for a new or revived terminal — while keeping the
archived terminal visible as history and avoiding duplication.

## Decisions (ratified by JWPK, 2026-05-31)

| # | Decision | Choice |
|---|---|---|
| 1 | Trigger timing | **Eager** — rename at archive time |
| 2 | Register on freed name | **Ask the user** — revive vs fresh |
| 3 | Where the tag lives | **Stored `name` column** |
| 4 | Non-interactive register with archived matches | **Fail loudly** — never silently pick fresh |
| 5 | `terminal_records` table | **In scope** — must also free its name |
| 6 | Offline reference | **Required** — MD recovery file in ObsidiANT / user-defined path |

## Naming scheme

- Format: `[A] <base>` for the first archive of a base name, then
  `[A-2] <base>`, `[A-3] <base>`, … (`[A]` ≡ sequence 1, number omitted).
- **Base name** = `name` with any leading `^\[A(-\d+)?\] ` prefix stripped.
  Tagging is **idempotent** — re-archiving an already-tagged row never yields
  `[A] [A] foo`.
- **Dedup at archive**: scan rows matching `^\[A(-\d+)?\] <base>$`, pick the next
  free sequence. The global `UNIQUE` on `terminals.name` is the backstop — on a
  race collision, retry with sequence+1.
- Helpers (new, in a small `terminalNameTag.ts` so they're unit-testable in
  isolation): `baseName(name)`, `tagArchivedName(base, seq)`,
  `nextArchiveSeq(base, existingNames)`, `isTagged(name)`.

## Architecture

### 1. One atomic archive transition (chokepoint)

`setTerminalStatus` becomes the single authority for status transitions and the
name rewrite is fused into the same `UPDATE`:

- **Refactor the two raw-SQL archive paths** to call `setTerminalStatus(id,
  'archived')` instead of issuing `UPDATE terminals SET status='archived'`
  directly:
  - `src/lib/server/reclaimRequestsStore.ts:401`
  - `src/lib/server/roomMembershipsStore.ts:429`
- The two existing `setTerminalStatus(..., 'archived')` callers
  (`agentStatusPoller.ts:114`, `:182`) need no change — they inherit the rename.
- Inside `setTerminalStatus`, in the **same `UPDATE`** that sets
  `status='archived'`: if the current name is not already tagged, compute the
  deduped `[A…]` name and write `name` + `status` + `updated_at` together. The
  flip and the vacate are inseparable — no partial state.

This honours the invariant the codebase already asserts: callers "can blindly
call `setTerminalStatus(id, 'archived')`" (`terminalLifecycle.test.ts:92`).

### 2. Symmetric restore on revive

`setTerminalStatus(id, 'live')` on a tagged row restores the **base** name *iff*
the base is free (no live terminal holds it). If a live terminal already owns the
base, the row keeps its tag (UNIQUE backstop). This makes the existing
archived→live reclaim paths (`reclaim/+server.ts:196,209`) self-heal — they don't
need to know about tagging.

### 3. `terminal_records` parity (decision #5)

`terminal_records` is a separate entity with its own global `name UNIQUE`
(`db.ts:434`) and a `superseded_at_ms` lifecycle marker (no `status` column).
When a `terminals` row archives, the corresponding `terminal_records` row (keyed
by `session_id`) must also vacate its name so record-side creation isn't blocked:

- Apply the same `[A…]` tag to `terminal_records.name`, and/or set
  `superseded_at_ms`, in lockstep with the `terminals` transition.
- The mapping `terminals.id`/session ↔ `terminal_records.session_id` must be
  resolved in the chokepoint (or a thin coordinator the chokepoint calls).
- **Planning task:** confirm the exact `terminals` ↔ `terminal_records` key
  (session_id vs name) and whether `superseded_at_ms` alone frees the name or the
  rename is also required. Both surfaces must end the transition with the base
  name free and the history row recoverable.

### 4. Register flow — revive vs fresh (decision #2 + #4)

Registration is non-interactive HTTP, so the decision surfaces at the CLI
(`scripts/ant-cli-register.mjs`) and the register endpoint
(`src/routes/api/identity/register/+server.ts`):

1. `ant register --name terminal3` → look up archived rows whose **base** =
   `terminal3`.
2. **No archived matches** → register normally (unchanged path).
3. **Archived matches + interactive (TTY)** → prompt:
   `Found archived: [A] terminal3 (last seen …, @handle), [A-2] terminal3 (…).
   [r]evive #N / [f]resh / [c]ancel?`
   - `revive #N` → `--revive <id>` → `setTerminalStatus(id,'live')` (restores
     base + rebinds PID via the existing upsert path).
   - `fresh` → `--fresh` → new `terminals` row with the base name; archived rows
     stay tagged.
4. **Archived matches + NON-interactive + no explicit flag → FAIL LOUDLY**
   (decision #4): exit non-zero with a message listing the recoverable archives
   and instructing the caller to pass `--revive <id>` or `--fresh`. Never
   silently create fresh, never silently revive.

The endpoint accepts `revive` / `fresh` intent; the CLI owns TTY detection and
prompting. Automated/agent registers that genuinely want fresh must pass
`--fresh` explicitly — the ambiguity is surfaced, not guessed.

### 5. Offline recovery reference (decision #6)

If the ANT server/daemon is down, the user must still be able to see which
archived terminals exist and how to recover them. Reuse the existing projected
mirror rather than build new plumbing:

- Extend `buildAntRegistryMarkdown()` (`src/lib/server/antRegistryFile.ts:30`)
  with a **`## Recoverable archived terminals`** section: one row per archived
  terminal — base name, current `[A…]` tag, `@handle`, last-seen, last PID/tmux
  pane, and the exact `ant register --name <base> --revive <id>` command.
- Resolve the destination via `resolveMemoryVaultPath()`
  (`src/lib/server/memoryVaultSettingsStore.ts:73`) so it writes into the
  **ObsidiANT vault** (or the user-defined path / `ANT_REGISTRY_FILE_PATH`
  env override), in addition to the current `~/Documents/ant-registry.md`.
- Keep the existing **best-effort, never-block** wrapper
  (`projectAntRegistryFileBestEffort`, `antRegistryFile.ts:126`): a failed
  recovery-file write must never stop a terminal from archiving or a register
  from completing.
- The file stays a projected mirror ("ANT database state is canonical",
  `antRegistryFile.ts:77`).

## Data flow

```
archive trigger (pane gone | heartbeat stale | reclaim | membership supersede)
        │
        ▼
setTerminalStatus(id, 'archived')                ← single chokepoint
        │  ├─ compute base + next [A…] seq (dedup, UNIQUE backstop)
        │  ├─ UPDATE terminals SET name=[A…], status='archived', updated_at  (atomic)
        │  └─ tag/supersede matching terminal_records.name
        ▼
projectAntRegistryFileBestEffort()
        ├─ ~/Documents/ant-registry.md  (existing)
        └─ <ObsidiANT vault>/...        (new mirror, recovery section)

ant register --name terminal3
        │
        ├─ no archived match → register (unchanged)
        ├─ TTY + match      → prompt revive/fresh/cancel
        └─ non-TTY + match  → FAIL LOUDLY (require --revive/--fresh)
```

## Error handling

- **Race on computed `[A…]` name** → caught by global `UNIQUE`; retry seq+1
  (bounded retry, then surface a clear error).
- **Revive when base now taken by a live terminal** → keep tag; CLI reports
  conflict and offers fresh.
- **Recovery-file write failure** → swallowed by best-effort wrapper, logged,
  never blocks the transition.
- **terminal_records desync** → the transition must update both surfaces in one
  logical step; a failure on the records side should not leave `terminals`
  half-renamed (wrap in the identity DB transaction).

## Testing

- **Unit (`terminalNameTag.ts`)**: base parse; tag/untag idempotency; seq
  increment with gaps; `isTagged`.
- **Lifecycle**: each of the **four** archive paths vacates the base name;
  archived→live restores base; restore-when-base-taken keeps tag.
- **terminal_records**: archiving a terminal frees the matching record name;
  recovery does not collide.
- **Register**: no-match passthrough; `--revive`; `--fresh`; non-interactive +
  match + no flag → non-zero exit (fail-loud); revive-when-base-taken guard.
- **Recovery file**: archived terminals appear in the `## Recoverable archived
  terminals` section with a correct `--revive` command; write targets both the
  default path and the resolved vault path; write failure never throws.

## Scope / non-goals

- No change to the global `UNIQUE` schema constraint (option (b) — mutate the
  name, leave the index predicate untouched).
- No change to `@handle` identity — only display `name` is tagged; reclaim/handle
  flows are unaffected.
- No retroactive bulk-rename migration of *already*-archived terminals in this
  change unless planning finds it trivial; new archives are tagged going forward.
  (Open: a one-shot backfill may be desirable so existing squatters free up — to
  be decided in planning.)

## Files touched (anticipated)

- `src/lib/server/terminalNameTag.ts` — **new** pure helpers.
- `src/lib/server/terminalsStore.ts` — `setTerminalStatus` rename fusion +
  symmetric restore.
- `src/lib/server/reclaimRequestsStore.ts` — route through `setTerminalStatus`.
- `src/lib/server/roomMembershipsStore.ts` — route through `setTerminalStatus`.
- `src/lib/server/terminalRecordsStore.ts` — record-side name vacate/supersede.
- `src/lib/server/antRegistryFile.ts` — recovery section + vault mirror target.
- `src/routes/api/identity/register/+server.ts` — revive/fresh intent.
- `scripts/ant-cli-register.mjs` — TTY prompt + fail-loud + flags.
- Tests alongside each.

<!-- Open planning questions are inline above (terminal_records key, backfill). -->
