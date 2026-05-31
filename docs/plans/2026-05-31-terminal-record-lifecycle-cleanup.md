# Terminal-record Lifecycle Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `/terminals` "Archived" section growing forever — never orphan a `terminal_records` row on terminal delete (Fix #1), and age out dead records via the existing retention sweep (Fix #2).

**Architecture:** App-level: terminal-row deletes (`deleteTerminalById`, `sweepExpiredTerminals`) also delete the matching `terminal_records` (keyed by `session_id === terminals.id`) in one transaction; the scheduled `pruneOperationalHistory` sweep additionally deletes superseded/orphaned records older than the existing `retentionDays` cutoff. No schema migration, no change to archive/rename semantics.

**Tech Stack:** TypeScript, better-sqlite3 (synchronous), Vitest.

**Spec:** `docs/specs/2026-05-31-terminal-record-lifecycle-cleanup-design.md`

**Conventions:**
- Run one test file: `npx vitest run <path>` ; one test: add `-t "<name>"`.
- Typecheck: `npm run check`.
- Test harness (copy from `src/lib/server/terminalLifecycle.test.ts:37-57`): per-test temp DB via `process.env.ANT_FRESH_DB_PATH` + `resetIdentityDbForTests()`, and `process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test'`.
- Key facts: `terminal_records.session_id === terminals.id`, no FK between them. `terminal_records` has `superseded_at_ms` + `updated_at_ms`. `deleteTerminalById` is `terminalsStore.ts:314-319`, `sweepExpiredTerminals` is `:321-328`, `pruneOperationalHistory` is `operationalRetention.ts:72`.

---

## Task 1: Terminal delete also removes its terminal_record (Fix #1)

**Files:**
- Modify: `src/lib/server/terminalsStore.ts` (`deleteTerminalById` :314-319, `sweepExpiredTerminals` :321-328)
- Test: `src/lib/server/terminalRecordCleanup.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `src/lib/server/terminalRecordCleanup.test.ts`

```typescript
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  upsertTerminal,
  getTerminalById,
  deleteTerminalById,
  sweepExpiredTerminals,
  setTerminalStatus
} from './terminalsStore';
import { createTerminalRecord, getTerminalRecord } from './terminalRecordsStore';
import { getIdentityDb, resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-recclean-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('terminal delete removes the matching terminal_record', () => {
  it('deleteTerminalById removes BOTH the terminal and its record', () => {
    const t = upsertTerminal({ pid: 900001, pid_start: 'a', name: 'rec-del-1' });
    createTerminalRecord({ sessionId: t.id, name: 'rec-del-1' });
    expect(getTerminalRecord(t.id)).not.toBeNull();
    expect(deleteTerminalById(t.id)).toBe(true);
    expect(getTerminalById(t.id)).toBeNull();
    expect(getTerminalRecord(t.id)).toBeNull(); // no orphan
  });

  it('deleteTerminalById still returns true / is safe when no record exists', () => {
    const t = upsertTerminal({ pid: 900002, pid_start: 'b', name: 'rec-del-2' });
    expect(deleteTerminalById(t.id)).toBe(true);
    expect(getTerminalById(t.id)).toBeNull();
  });

  it('sweepExpiredTerminals removes the record for expired terminals too', () => {
    const t = upsertTerminal({ pid: 900003, pid_start: 'c', name: 'rec-del-3' });
    createTerminalRecord({ sessionId: t.id, name: 'rec-del-3' });
    // Force expiry (ttl min is 60s, so set expires_at into the past directly).
    getIdentityDb().prepare(`UPDATE terminals SET expires_at = 1 WHERE id = ?`).run(t.id);
    expect(sweepExpiredTerminals()).toBeGreaterThanOrEqual(1);
    expect(getTerminalById(t.id)).toBeNull();
    expect(getTerminalRecord(t.id)).toBeNull(); // no orphan
  });

  it('ARCHIVE (status flip) KEEPS the record — only renames + supersedes it', () => {
    const t = upsertTerminal({ pid: 900004, pid_start: 'd', name: 'rec-keep-4' });
    createTerminalRecord({ sessionId: t.id, name: 'rec-keep-4' });
    setTerminalStatus(t.id, 'archived');
    const rec = getTerminalRecord(t.id);
    expect(rec).not.toBeNull();                       // record kept
    expect(rec?.name).toBe('[A] rec-keep-4');          // renamed by the chokepoint
    expect(rec?.superseded_at_ms).not.toBeNull();      // superseded, not deleted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/terminalRecordCleanup.test.ts`
Expected: the `deleteTerminalById`/`sweepExpiredTerminals` cases FAIL — `getTerminalRecord(t.id)` is still non-null (orphan). The ARCHIVE case should already PASS (Task-2 chokepoint behaviour from the prior feature).

- [ ] **Step 3: Implement** — replace `deleteTerminalById` and `sweepExpiredTerminals` in `src/lib/server/terminalsStore.ts`

```typescript
export function deleteTerminalById(id: string): boolean {
  const db = getIdentityDb();
  const deleteBoth = db.transaction((): number => {
    const info = db.prepare(`DELETE FROM terminals WHERE id = ?`).run(id);
    // terminal_records has no FK to terminals — delete the matching record
    // (session_id === terminals.id) so a hard-delete never orphans it. A
    // record without a terminals row (or vice-versa) just deletes 0 here.
    db.prepare(`DELETE FROM terminal_records WHERE session_id = ?`).run(id);
    return info.changes;
  });
  const changes = deleteBoth();
  if (changes > 0) projectAntRegistryFileBestEffort();
  return changes > 0;
}

export function sweepExpiredTerminals(): number {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const sweep = db.transaction((): number => {
    // Delete the matching terminal_records FIRST (no FK to cascade), then the
    // expired terminals themselves — same expiry predicate for both.
    db.prepare(
      `DELETE FROM terminal_records WHERE session_id IN
         (SELECT id FROM terminals WHERE expires_at IS NOT NULL AND expires_at <= ?)`
    ).run(now);
    const info = db.prepare(
      `DELETE FROM terminals WHERE expires_at IS NOT NULL AND expires_at <= ?`
    ).run(now);
    return info.changes;
  });
  const changes = sweep();
  if (changes > 0) projectAntRegistryFileBestEffort();
  return changes;
}
```

(`currentUnixSeconds`, `getIdentityDb`, `projectAntRegistryFileBestEffort` are already imported/defined in this file — used by the existing versions. Do not re-import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/terminalRecordCleanup.test.ts`
Expected: all 4 PASS.

- [ ] **Step 5: Regression — existing terminals-store suites**

Run: `npx vitest run src/lib/server/terminalsStore.test.ts src/lib/server/terminalLifecycle.test.ts`
Expected: PASS. (If a test asserted `deleteTerminalById` leaves a record, that was asserting the bug — update it and note it; otherwise none should change.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/terminalsStore.ts src/lib/server/terminalRecordCleanup.test.ts
git commit -m "fix(terminals): delete matching terminal_record on terminal delete (no orphans)"
```

---

## Task 2: Retention sweep ages out dead terminal_records (Fix #2)

**Files:**
- Modify: `src/lib/server/operationalRetention.ts` (`OperationalRetentionResult` type :21-31, `pruneOperationalHistory` :72)
- Test: `src/lib/server/operationalRetention.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `src/lib/server/operationalRetention.test.ts` inside the existing `describe('operationalRetention', …)` block

```typescript
  it('prunes superseded/orphaned terminal_records older than the cutoff, keeps the rest', () => {
    const db = getIdentityDb();
    const nowMs = 1_000_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const old = nowMs - 40 * dayMs;   // older than a 30d retention
    const recent = nowMs - 1 * dayMs; // within retention
    // A live terminal so "has backing terminal" cases are real.
    db.prepare(
      `INSERT INTO terminals (id, pid, pid_start, name, source, meta, created_at, updated_at)
       VALUES ('term-live', 1, 'x', 'live-term', 'cli-register', '{}', 1, 1)`
    ).run();
    const ins = (sid: string, name: string, superseded: number | null, updated: number) =>
      db.prepare(
        `INSERT INTO terminal_records (session_id, name, auto_forward_chat, created_at_ms, updated_at_ms, superseded_at_ms)
         VALUES (?, ?, 1, ?, ?, ?)`
      ).run(sid, name, updated, updated, superseded);
    ins('term-live', 'live-rec', null, recent);       // live + not superseded → KEEP
    ins('gone-1', '[A] old-superseded', old, old);     // superseded + old → PRUNE
    ins('gone-2', 'orphan-old', null, old);            // orphaned + old → PRUNE
    ins('keep-1', '[A] new-superseded', recent, recent); // superseded + recent → KEEP
    ins('keep-2', 'orphan-recent', null, recent);      // orphaned + recent → KEEP

    const res = pruneOperationalHistory({ nowMs, retentionDays: 30, trigger: 'manual' });
    expect(res.terminalRecordsDeleted).toBe(2);

    const names = (db.prepare(`SELECT name FROM terminal_records ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(['[A] new-superseded', 'live-rec', 'orphan-recent']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/operationalRetention.test.ts -t "prunes superseded"`
Expected: FAIL — `res.terminalRecordsDeleted` is `undefined` (property not yet on the result).

- [ ] **Step 3a: Extend the result type** — `src/lib/server/operationalRetention.ts` (`OperationalRetentionResult`, :21-31)

```typescript
export type OperationalRetentionResult = {
  retentionDays: number;
  cutoffMs: number;
  terminalRunEventsDeleted: number;
  cliHookEventsDeleted: number;
  terminalRecordsDeleted: number;
  vacuumed: boolean;
  trigger: 'manual' | 'scheduled' | 'threshold';
  dbBytesBefore: number;
  dbBytesAfter: number;
  maxDbBytes: number;
};
```

- [ ] **Step 3b: Add the prune + wire it into totals/result** — in `pruneOperationalHistory`, immediately after the `cliHookEventsDeleted = deleteInBatches({...})` block and before `const deletedTotal = …`

```typescript
  // Age out dead terminal_records (spec 2026-05-31): a record is removed only
  // when it is dead (superseded — replaced/archived — OR orphaned, no backing
  // terminal) AND aged past the same retention cutoff. Age = superseded_at_ms
  // when present, else updated_at_ms. Recent/live records are preserved.
  const terminalRecordsDeleted = db.prepare(
    `DELETE FROM terminal_records
       WHERE (superseded_at_ms IS NOT NULL OR session_id NOT IN (SELECT id FROM terminals))
         AND COALESCE(superseded_at_ms, updated_at_ms) < ?`
  ).run(cutoffMs).changes;
```

Change the totals line to include it:
```typescript
  const deletedTotal = terminalRunEventsDeleted + cliHookEventsDeleted + terminalRecordsDeleted;
```

Add it to the returned `result` object (alongside `cliHookEventsDeleted`):
```typescript
    terminalRunEventsDeleted,
    cliHookEventsDeleted,
    terminalRecordsDeleted,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/operationalRetention.test.ts`
Expected: the new test + all existing operationalRetention tests PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run check 2>&1 | grep -iE "operationalRetention|terminalsStore|error TS" | head`
Expected: no new errors. (The new required `terminalRecordsDeleted` field is set in the only place that builds the result, so no other call site breaks.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/operationalRetention.ts src/lib/server/operationalRetention.test.ts
git commit -m "feat(retention): age out superseded/orphaned terminal_records in the sweep"
```

---

## Final verification

- [ ] Run all touched suites:

```bash
npx vitest run \
  src/lib/server/terminalRecordCleanup.test.ts \
  src/lib/server/terminalsStore.test.ts \
  src/lib/server/terminalLifecycle.test.ts \
  src/lib/server/operationalRetention.test.ts
```
Expected: all PASS.

- [ ] `npm run check` — clean (no new errors in touched files).
- [ ] Deploy (per `project_ant_server_deploy_mechanism_2026_05_31`): `npm run build` → `launchctl kickstart -k gui/$(id -u)/com.ant.fresh` → curl `:6174` to trigger init.

---

## Self-review notes (author)

- **Spec coverage:** Fix #1 (delete-both, archive-keeps) → Task 1; Fix #2 (superseded/orphaned aged-out via retentionDays cutoff, result field) → Task 2. Both decisions (#1 app-level, #2 superseded+orphaned conservative, #3 tie-to-retentionDays) implemented.
- **Placeholders:** none — every step has runnable code/commands.
- **Type consistency:** `terminalRecordsDeleted` added to the type AND set in `pruneOperationalHistory`'s result; `deleteTerminalById`/`sweepExpiredTerminals` keep their `boolean`/`number` return signatures; predicate uses real columns `superseded_at_ms`/`updated_at_ms`/`session_id`.
