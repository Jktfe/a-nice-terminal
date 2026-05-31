# Terminal-record lifecycle cleanup — design

**Date:** 2026-05-31
**Status:** Design (awaiting review)
**Author:** recoveryfixes session

## Problem

The `/terminals` UI "Archived terminals — tmux pane gone, kept for history"
section lists `terminal_records` whose tmux pane isn't currently live
(`/api/terminals` GET marks each record `alive` iff its `session_id` is a live
pane). Two failure modes let that section grow without bound:

1. **Orphaning on terminal delete.** `terminal_records` has **no FK** to
   `terminals`. `deleteTerminalById` (`terminalsStore.ts:314`) and
   `sweepExpiredTerminals` (`:321`) `DELETE FROM terminals` only, leaving the
   matching `terminal_records` row behind as a permanent orphan. (This is what
   left 36 `[A] auto:*` orphan records after the 2026-05-31 archived-terminal
   hard-delete.)
2. **No pruning of dead records.** Even correctly-superseded records (pane
   recycled, or terminal archived → record renamed `[A]…` + superseded by the
   `[A]` chokepoint) are never removed, so the "archived" section accumulates
   one card per dead agent forever.

## Decisions (ratified by JWPK, 2026-05-31)

| # | Decision | Choice |
|---|---|---|
| 1 | Orphan fix mechanism | **App-level delete-both** (no FK migration) |
| 2 | Prune aggressiveness | **Superseded OR orphaned, aged out** (conservative) |
| 3 | Retention threshold | **Tie to existing `getOperationalRetentionDays()`** |

## Fix #1 — never orphan a record on terminal delete

When a `terminals` row is physically deleted, delete its matching
`terminal_records` row (keyed by `session_id === terminals.id`) in the same
operation. This is **delete-only** — it does NOT fire on archive: archiving is a
`status` flip (no row delete), so the `[A]` chokepoint's keep-and-rename
behaviour is unchanged.

- **`deleteTerminalById(id)`** (`terminalsStore.ts:314-319`): after the existing
  `DELETE FROM terminals WHERE id = ?`, add `DELETE FROM terminal_records WHERE
  session_id = ?`, both inside one `db.transaction`. Inline the SQL (do **not**
  import `deleteTerminalRecord` from `terminalRecordsStore` — `terminalsStore`
  already imports a *type* from that module; a value import risks a cycle).
- **`sweepExpiredTerminals()`** (`terminalsStore.ts:321-328`): inside one
  transaction, delete records first by subquery, then the terminals:
  ```sql
  DELETE FROM terminal_records WHERE session_id IN
    (SELECT id FROM terminals WHERE expires_at IS NOT NULL AND expires_at <= :now);
  DELETE FROM terminals WHERE expires_at IS NOT NULL AND expires_at <= :now;
  ```
- Both keep their existing single `projectAntRegistryFileBestEffort()` call.

## Fix #2 — age out dead records via the existing retention sweep

Extend `pruneOperationalHistory` (`operationalRetention.ts:72`) — already booted
on startup and run on schedule + DB-size threshold — to also prune dead
`terminal_records`, governed by the same `retentionDays` cutoff it already
computes (`cutoffMs`).

Add after the `cli_hook_events` delete, before `deletedTotal`:
```ts
const terminalRecordsDeleted = db.prepare(
  `DELETE FROM terminal_records
     WHERE (superseded_at_ms IS NOT NULL OR session_id NOT IN (SELECT id FROM terminals))
       AND COALESCE(superseded_at_ms, updated_at_ms) < ?`
).run(cutoffMs).changes;
```
- **Predicate:** a record is pruned only if it is **dead** (superseded, i.e.
  replaced/archived; OR orphaned, i.e. no backing terminal) **AND aged** past the
  cutoff. Age is measured by `superseded_at_ms` when present, else
  `updated_at_ms` (orphans). A dead-but-recent record (e.g. agent just stopped,
  or a brief no-terminal race) is preserved until it ages out.
- **Why this catches the named roster too:** when an agent's pane dies, the
  poller archives its terminal → the `[A]` chokepoint sets the record's
  `superseded_at_ms` → it ages out here. No separate "named record" path needed.
- Add `terminalRecordsDeleted` to `deletedTotal` (so the vacuum-on-delete and
  threshold logic account for it) and to the returned
  `OperationalRetentionResult` object. Extend the
  `OperationalRetentionResult` type with `terminalRecordsDeleted: number`.

## Data flow

```
terminal physically deleted (deleteTerminalById | sweepExpiredTerminals)
        └─ same txn → also DELETE matching terminal_records   [Fix #1]

terminal archived (setTerminalStatus 'archived')   ← unchanged
        └─ record kept, renamed [A]…, superseded_at_ms set

retention sweep tick (scheduled / threshold)        [Fix #2]
        └─ DELETE terminal_records WHERE (superseded OR orphaned)
                                      AND aged past retentionDays cutoff
```

## Error handling
- Both fixes are best-effort within their existing call sites; a failure must not
  throw past the current behaviour. Fix #1's two deletes share a transaction so a
  mid-flight failure rolls back cleanly (no half-deleted state).
- The sweep prune is one statement; if it throws, the surrounding sweep already
  runs under the operational-retention boot wrapper.

## Testing
- **Fix #1:** `deleteTerminalById` removes BOTH the terminal and its record;
  `sweepExpiredTerminals` removes both for expired terminals; **archiving**
  (`setTerminalStatus 'archived'`) leaves the record present (renamed +
  superseded, NOT deleted).
- **Fix #2:** sweep prunes a superseded+aged record; prunes an orphaned+aged
  record; **preserves** a superseded-but-recent record, an orphaned-but-recent
  record, and a live (not-superseded, has-terminal) record; the returned result
  reports `terminalRecordsDeleted`.

## Scope / non-goals
- No FK / schema migration (decision #1).
- No change to the `[A]` archive/rename semantics or the poller.
- No UI change — pruning at the data layer empties the section naturally; no
  separate display filter (YAGNI given the sweep handles it).
- No dedicated retention knob — reuse `getOperationalRetentionDays()` (decision
  #3).

## Files touched
- `src/lib/server/terminalsStore.ts` — `deleteTerminalById`, `sweepExpiredTerminals`
- `src/lib/server/operationalRetention.ts` — `pruneOperationalHistory` + `OperationalRetentionResult` type
- Tests alongside each.
- Deploy: `npm run build` → `launchctl kickstart -k gui/$(id -u)/com.ant.fresh` (per the deploy-mechanism note).
