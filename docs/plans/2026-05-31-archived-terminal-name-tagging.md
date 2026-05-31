# Archived Terminal Name Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a terminal is archived, vacate its base name by tagging it `[A] <base>` (or `[A-2] <base>`…) so the base name is immediately free for a new or revived terminal, while keeping the archived terminal as recoverable history.

**Architecture:** Pure naming helpers (`terminalNameTag.ts`) drive a single archive chokepoint (`setTerminalStatus`) that fuses the status flip and the name rewrite into one atomic transaction across both `terminals` and `terminal_records`. The two raw-SQL archive paths are routed through that chokepoint. Registration gains a revive-vs-fresh decision (interactive prompt, fail-loud when non-interactive). A backfill tags existing squatters, and the existing best-effort MD projection gains a recovery section written to both the default path and the ObsidiANT vault.

**Tech Stack:** TypeScript, SvelteKit endpoints, better-sqlite3 (synchronous), Vitest, Node CLI (`.mjs`).

**Spec:** `docs/specs/2026-05-31-archived-terminal-name-tagging-design.md`

**Conventions:**
- Run a single test file: `npx vitest run <path>`
- Run one test by name: `npx vitest run <path> -t "<test name>"`
- Typecheck: `npm run check`
- Test DB harness (copy from `src/lib/server/terminalLifecycle.test.ts:37-57`): per-test temp DB via `process.env.ANT_FRESH_DB_PATH` + `resetIdentityDbForTests()`, and `process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test'`.
- Key fact: `terminal_records.session_id === terminals.id` (the join in `antRegistryFile.ts:148` is `t.id = tr.session_id`).
- Both `terminals.name` and `terminal_records.name` are `TEXT NOT NULL UNIQUE` (`db.ts:47`, `db.ts:434`).

---

## Task 1: Pure naming helpers (`terminalNameTag.ts`)

**Files:**
- Create: `src/lib/server/terminalNameTag.ts`
- Test: `src/lib/server/terminalNameTag.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/server/terminalNameTag.test.ts
import { describe, expect, it } from 'vitest';
import {
  baseName,
  isTagged,
  parseArchiveSeq,
  tagArchivedName,
  nextArchiveSeq
} from './terminalNameTag';

describe('baseName', () => {
  it('returns the name unchanged when untagged', () => {
    expect(baseName('terminal3')).toBe('terminal3');
  });
  it('strips a [A] prefix', () => {
    expect(baseName('[A] terminal3')).toBe('terminal3');
  });
  it('strips a [A-2] prefix', () => {
    expect(baseName('[A-12] terminal3')).toBe('terminal3');
  });
  it('strips only one prefix (idempotent re-tag never doubles)', () => {
    expect(baseName('[A] [A] terminal3')).toBe('[A] terminal3');
  });
  it('preserves a base name that itself contains brackets later on', () => {
    expect(baseName('build [stage 2]')).toBe('build [stage 2]');
  });
});

describe('isTagged / parseArchiveSeq', () => {
  it('detects an untagged name', () => {
    expect(isTagged('terminal3')).toBe(false);
    expect(parseArchiveSeq('terminal3')).toBe(0);
  });
  it('reads [A] as sequence 1', () => {
    expect(isTagged('[A] terminal3')).toBe(true);
    expect(parseArchiveSeq('[A] terminal3')).toBe(1);
  });
  it('reads [A-3] as sequence 3', () => {
    expect(parseArchiveSeq('[A-3] terminal3')).toBe(3);
  });
});

describe('tagArchivedName', () => {
  it('uses [A] for sequence 1 (no number)', () => {
    expect(tagArchivedName('terminal3', 1)).toBe('[A] terminal3');
  });
  it('uses [A-N] for sequence >= 2', () => {
    expect(tagArchivedName('terminal3', 2)).toBe('[A-2] terminal3');
    expect(tagArchivedName('terminal3', 5)).toBe('[A-5] terminal3');
  });
  it('tags the BASE even if passed an already-tagged name', () => {
    expect(tagArchivedName('[A] terminal3', 2)).toBe('[A-2] terminal3');
  });
});

describe('nextArchiveSeq', () => {
  it('returns 1 when no tagged siblings exist', () => {
    expect(nextArchiveSeq('terminal3', ['terminal3', 'other'])).toBe(1);
  });
  it('returns 2 when [A] is taken', () => {
    expect(nextArchiveSeq('terminal3', ['[A] terminal3'])).toBe(2);
  });
  it('fills the smallest free slot when there are gaps', () => {
    // [A] and [A-3] taken, [A-2] free -> next is 2
    expect(nextArchiveSeq('terminal3', ['[A] terminal3', '[A-3] terminal3'])).toBe(2);
  });
  it('ignores siblings with a different base', () => {
    expect(nextArchiveSeq('terminal3', ['[A] terminal9', '[A-2] terminal9'])).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/terminalNameTag.test.ts`
Expected: FAIL — "Failed to resolve import './terminalNameTag'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/server/terminalNameTag.ts
/**
 * Pure helpers for the archived-terminal name tag `[A] <base>` /
 * `[A-N] <base>`. No DB access — all functions are total and testable in
 * isolation. Spec: docs/specs/2026-05-31-archived-terminal-name-tagging-design.md
 *
 * Tagging frees the base name in the global UNIQUE index on terminals.name
 * (and terminal_records.name) the moment a terminal is archived, so a fresh
 * or revived terminal can reuse it. `[A]` is sequence 1 (number omitted);
 * `[A-2]`, `[A-3]` … are subsequent archives of the same base.
 */

// Matches a single leading tag prefix only — so re-tagging never doubles up.
const TAG_PREFIX = /^\[A(?:-(\d+))?\] /;

/** The name with any single leading `[A]` / `[A-N]` prefix removed. */
export function baseName(name: string): string {
  return name.replace(TAG_PREFIX, '');
}

/** True when the name carries a leading archive tag. */
export function isTagged(name: string): boolean {
  return TAG_PREFIX.test(name);
}

/** Sequence number encoded in the tag: `[A]`=1, `[A-N]`=N, untagged=0. */
export function parseArchiveSeq(name: string): number {
  const m = TAG_PREFIX.exec(name);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 1;
}

/** Build the tagged name for a given base at sequence `seq` (>=1). */
export function tagArchivedName(name: string, seq: number): string {
  const base = baseName(name);
  return seq <= 1 ? `[A] ${base}` : `[A-${seq}] ${base}`;
}

/**
 * Smallest free sequence (>=1) for `base` given a list of existing names.
 * Only names whose base matches `base` and which are tagged are considered.
 */
export function nextArchiveSeq(base: string, existingNames: string[]): number {
  const used = new Set<number>();
  for (const name of existingNames) {
    if (isTagged(name) && baseName(name) === base) {
      used.add(parseArchiveSeq(name));
    }
  }
  let seq = 1;
  while (used.has(seq)) seq++;
  return seq;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/terminalNameTag.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/terminalNameTag.ts src/lib/server/terminalNameTag.test.ts
git commit -m "feat(terminals): pure [A] archive-name tag helpers"
```

---

## Task 2: Fuse rename into the archive chokepoint (`setTerminalStatus`)

Make `setTerminalStatus` the single authority: on `→ archived` it tags the name (terminals + matching terminal_records); on `→ live` it restores the base name when free. All inside one transaction.

**Files:**
- Modify: `src/lib/server/terminalsStore.ts:402-414` (`setTerminalStatus`)
- Test: `src/lib/server/terminalNameVacate.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/server/terminalNameVacate.test.ts
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getTerminalById,
  getLiveTerminalByName,
  setTerminalStatus,
  upsertTerminal
} from './terminalsStore';
import { createTerminalRecord, getTerminalRecord } from './terminalRecordsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-vacate-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeTerminal(name: string) {
  return upsertTerminal({ pid: Math.floor(1e6 + Math.abs(hash(name)) % 1e5),
    pid_start: name, name });
}
function hash(s: string): number {
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h;
}

describe('setTerminalStatus archives by vacating the name', () => {
  it('tags terminals.name [A] <base> on archive', () => {
    const t = makeTerminal('terminal3');
    setTerminalStatus(t.id, 'archived');
    expect(getTerminalById(t.id)?.name).toBe('[A] terminal3');
    // base name is now free for a fresh live terminal
    expect(getLiveTerminalByName('terminal3')).toBeNull();
  });

  it('increments to [A-2] when [A] <base> already exists', () => {
    const first = makeTerminal('terminal3');
    setTerminalStatus(first.id, 'archived');     // -> [A] terminal3
    const second = makeTerminal('terminal3');    // base free again
    setTerminalStatus(second.id, 'archived');    // -> [A-2] terminal3
    expect(getTerminalById(second.id)?.name).toBe('[A-2] terminal3');
  });

  it('is idempotent — re-archiving an already-tagged row does not double-tag', () => {
    const t = makeTerminal('terminal3');
    setTerminalStatus(t.id, 'archived');
    setTerminalStatus(t.id, 'archived');
    expect(getTerminalById(t.id)?.name).toBe('[A] terminal3');
  });

  it('also vacates the matching terminal_records.name', () => {
    const t = makeTerminal('terminal3');
    createTerminalRecord({ sessionId: t.id, name: 'terminal3' });
    setTerminalStatus(t.id, 'archived');
    expect(getTerminalRecord(t.id)?.name).toBe('[A] terminal3');
    expect(getTerminalRecord(t.id)?.superseded_at_ms).not.toBeNull();
  });

  it('restores the base name on revive when the base is free', () => {
    const t = makeTerminal('terminal3');
    setTerminalStatus(t.id, 'archived');         // -> [A] terminal3
    setTerminalStatus(t.id, 'live');             // -> terminal3
    expect(getTerminalById(t.id)?.name).toBe('terminal3');
    expect(getLiveTerminalByName('terminal3')?.id).toBe(t.id);
  });

  it('keeps the tag on revive when a live terminal already owns the base', () => {
    const archived = makeTerminal('terminal3');
    setTerminalStatus(archived.id, 'archived');  // -> [A] terminal3
    makeTerminal('terminal3');                   // fresh live terminal3
    setTerminalStatus(archived.id, 'live');      // base taken -> keep tag
    expect(getTerminalById(archived.id)?.name).toBe('[A] terminal3');
  });

  it('returns false for an unknown terminalId', () => {
    expect(setTerminalStatus('nope', 'archived')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/terminalNameVacate.test.ts`
Expected: FAIL — first test fails: name is still `terminal3`, not `[A] terminal3`.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `setTerminalStatus` in `src/lib/server/terminalsStore.ts` (currently lines 402-414). Add the import at the top of the file (next to the existing imports near line 23):

```typescript
import { baseName, isTagged, nextArchiveSeq, tagArchivedName } from './terminalNameTag';
```

```typescript
// src/lib/server/terminalsStore.ts  (replaces setTerminalStatus)
/**
 * Single authority for terminal lifecycle transitions. The status flip
 * and the name rewrite are fused into ONE transaction so "becoming
 * archived" and "vacating the base name" can never be partially applied.
 *
 *  - → 'archived': if the name is untagged, rewrite terminals.name (and the
 *    matching terminal_records row, keyed by session_id === terminals.id) to
 *    the next free `[A] <base>` / `[A-N] <base>`, freeing the base name in
 *    the global UNIQUE index. Idempotent: an already-tagged row is left as-is.
 *  - → 'live': if the name is tagged AND the base is free of any other live
 *    terminal, restore the base name (revive). If a live terminal already
 *    owns the base, keep the tag (UNIQUE backstop).
 *  - → 'deleted': status only, no rename.
 *
 * Returns true when the row existed, false for an unknown terminalId.
 */
export function setTerminalStatus(
  terminalId: string,
  status: 'live' | 'archived' | 'deleted'
): boolean {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const nowMs = Date.now();
  const txn = db.transaction((): boolean => {
    const row = db
      .prepare(`SELECT id, name FROM terminals WHERE id = ?`)
      .get(terminalId) as { id: string; name: string } | undefined;
    if (!row) return false;

    let nextName = row.name;
    if (status === 'archived' && !isTagged(row.name)) {
      const base = baseName(row.name);
      // Sibling names that already hold a tag for this base, plus a retry
      // backstop on the global UNIQUE (concurrent archive of same base).
      for (let attempt = 0; attempt < 50; attempt++) {
        const siblings = db
          .prepare(`SELECT name FROM terminals WHERE name LIKE '[A%] ' || ?`)
          .all(base) as { name: string }[];
        const seq = nextArchiveSeq(base, siblings.map((s) => s.name)) + attempt;
        const candidate = tagArchivedName(base, seq);
        const clash = db
          .prepare(`SELECT 1 FROM terminals WHERE name = ?`)
          .get(candidate);
        if (!clash) { nextName = candidate; break; }
      }
    } else if (status === 'live' && isTagged(row.name)) {
      const base = baseName(row.name);
      const baseTaken = db
        .prepare(
          `SELECT 1 FROM terminals WHERE name = ? AND status = 'live' AND id != ?`
        )
        .get(base, row.id);
      if (!baseTaken) nextName = base;
    }

    db.prepare(`UPDATE terminals SET status = ?, name = ?, updated_at = ? WHERE id = ?`)
      .run(status, nextName, now, terminalId);

    // terminal_records parity (session_id === terminals.id). Free its name
    // in lockstep and mark superseded so picker queries skip the history row.
    if (nextName !== row.name) {
      const rec = db
        .prepare(`SELECT name FROM terminal_records WHERE session_id = ?`)
        .get(terminalId) as { name: string } | undefined;
      if (rec) {
        if (status === 'archived') {
          db.prepare(
            `UPDATE terminal_records SET name = ?, superseded_at_ms = ?, updated_at_ms = ? WHERE session_id = ?`
          ).run(nextName, nowMs, nowMs, terminalId);
        } else {
          db.prepare(
            `UPDATE terminal_records SET name = ?, updated_at_ms = ? WHERE session_id = ?`
          ).run(nextName, nowMs, terminalId);
        }
      }
    }
    return true;
  });
  const existed = txn();
  if (existed) projectAntRegistryFileBestEffort();
  return existed;
}
```

> Note: `LIKE '[A%] ' || ?` is safe in SQLite — `[` and `]` are literal in `LIKE`; only `%` and `_` are wildcards. The `nextArchiveSeq` helper re-filters by exact base, so the loose LIKE is just a prefilter.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/terminalNameVacate.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Run the existing lifecycle suite to confirm no regression**

Run: `npx vitest run src/lib/server/terminalLifecycle.test.ts`
Expected: PASS — those tests assert `status` and unknown-id `false`, which still hold.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/terminalsStore.ts src/lib/server/terminalNameVacate.test.ts
git commit -m "feat(terminals): vacate base name on archive, restore on revive (chokepoint)"
```

---

## Task 3: Route raw-SQL archive paths through the chokepoint

Two paths archive with raw SQL and skip the rename. Route them through `setTerminalStatus`.

**Files:**
- Modify: `src/lib/server/reclaimRequestsStore.ts:399-402`
- Modify: `src/lib/server/roomMembershipsStore.ts:425-431`
- Test: `src/lib/server/archivePathsVacateName.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/server/archivePathsVacateName.test.ts
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTerminalById, upsertTerminal } from './terminalsStore';
import { autoRebindMembershipsFromStaleTerminal, addMembership } from './roomMembershipsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-archpaths-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('autoRebindMembershipsFromStaleTerminal vacates the old name', () => {
  it('tags the archived old terminal name', () => {
    const oldT = upsertTerminal({ pid: 810001, pid_start: 'old', name: 'speedyc' });
    const newT = upsertTerminal({ pid: 810002, pid_start: 'new', name: 'speedyc-new' });
    addMembership({ roomId: 'room-1', handle: '@speedyc', terminalId: oldT.id });
    autoRebindMembershipsFromStaleTerminal({
      handle: '@speedyc', oldTerminalId: oldT.id, newTerminalId: newT.id, nowMs: Date.now()
    });
    expect(getTerminalById(oldT.id)?.name).toBe('[A] speedyc');
    expect(getTerminalById(oldT.id)?.status).toBe('archived');
  });
});
```

> Confirm `addMembership`'s exact argument shape against `src/lib/server/roomMembershipsStore.ts` before running (it is imported in `terminalLifecycle.test.ts:34`); adjust the call if the signature differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/archivePathsVacateName.test.ts`
Expected: FAIL — name is still `speedyc` (raw-SQL path didn't rename).

- [ ] **Step 3a: Edit `roomMembershipsStore.ts`**

The function `autoRebindMembershipsFromStaleTerminal` runs its own transaction (lines 410-439). Calling `setTerminalStatus` (which opens its own transaction) inside it would nest. better-sqlite3 supports nested `db.transaction()` via SAVEPOINT, so this is safe. Replace the raw archive UPDATE (lines 428-431):

```typescript
// REMOVE (roomMembershipsStore.ts:428-431):
    db.prepare(
      `UPDATE terminals SET status = 'archived', updated_at = ?
        WHERE id = ? AND status = 'live'`
    ).run(Math.floor(nowMs / 1000), oldTerminalId);
```

```typescript
// REPLACE WITH:
    // Route through the lifecycle chokepoint so the old name is vacated
    // (tagged [A] <base>) atomically with the archive. setTerminalStatus
    // opens a nested SAVEPOINT inside this transaction.
    setTerminalStatus(oldTerminalId, 'archived');
```

Add the import near the top of `roomMembershipsStore.ts` (with the other `./terminalsStore` / local imports):

```typescript
import { setTerminalStatus } from './terminalsStore';
```

> The existing line 435-438 raw UPDATE on `terminal_records` (superseded_at_ms) is now also handled by `setTerminalStatus`, but leaving it is harmless (idempotent re-set of superseded_at_ms + name already tagged). To avoid double work, DELETE lines 435-438 as well. Verify no other column in that block is needed.

- [ ] **Step 3b: Edit `reclaimRequestsStore.ts`**

Replace the raw archive UPDATE (lines 400-402):

```typescript
// REMOVE (reclaimRequestsStore.ts:400-402):
  const archiveResult = db
    .prepare(`UPDATE terminals SET status = 'archived', updated_at = ? WHERE id = ?`)
    .run(Math.floor(nowMs / 1000), terminalId);
```

```typescript
// REPLACE WITH:
  const archivedOk = setTerminalStatus(terminalId, 'archived');
  const archiveResult = { changes: archivedOk ? 1 : 0 };
```

Add the import near the top of `reclaimRequestsStore.ts`:

```typescript
import { setTerminalStatus } from './terminalsStore';
```

> `archiveResult.changes` is read at line ~414 for the structured action log — the shim object preserves that read.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/archivePathsVacateName.test.ts`
Expected: PASS.

- [ ] **Step 5: Run reclaim + membership suites for regressions**

Run: `npx vitest run src/routes/api/chat-rooms/[roomId]/members/[handle]/reclaim/server.test.ts src/lib/server/roomMembershipsStore.test.ts`
Expected: PASS. If a reclaim test asserts the old terminal's name is unchanged after archive, update it to expect the `[A] <base>` form (this is the intended new behaviour — note it in the commit).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/reclaimRequestsStore.ts src/lib/server/roomMembershipsStore.ts src/lib/server/archivePathsVacateName.test.ts
git commit -m "refactor(terminals): route raw-SQL archive paths through setTerminalStatus"
```

---

## Task 4: Register endpoint — revive / fresh intent + archived-match 409

When a register targets a base name that has archived matches and no intent flag, return a structured 409 so the CLI can decide. `fresh` proceeds to a new row; `revive <id>` un-archives the chosen history row.

**Files:**
- Create: `src/lib/server/archivedNameMatches.ts` (query helper)
- Modify: `src/routes/api/identity/register/+server.ts` (after line 182, before the handle block)
- Test: `src/lib/server/archivedNameMatches.test.ts`
- Test: `src/routes/api/identity/register/serverReviveFresh.test.ts`

- [ ] **Step 1: Write the failing helper test**

```typescript
// src/lib/server/archivedNameMatches.test.ts
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertTerminal, setTerminalStatus } from './terminalsStore';
import { listArchivedMatchesForBase } from './archivedNameMatches';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-archmatch-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('listArchivedMatchesForBase', () => {
  it('returns archived terminals whose base name equals the query', () => {
    const a = upsertTerminal({ pid: 820001, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');            // [A] terminal3
    const b = upsertTerminal({ pid: 820002, pid_start: 'b', name: 'terminal3' });
    setTerminalStatus(b.id, 'archived');            // [A-2] terminal3
    upsertTerminal({ pid: 820003, pid_start: 'c', name: 'terminal9' }); // unrelated, live
    const matches = listArchivedMatchesForBase('terminal3');
    expect(matches.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(matches.every((m) => m.base === 'terminal3')).toBe(true);
  });
  it('returns empty when no archived matches', () => {
    expect(listArchivedMatchesForBase('terminal3')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/server/archivedNameMatches.test.ts`
Expected: FAIL — cannot resolve `./archivedNameMatches`.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/server/archivedNameMatches.ts
import { getIdentityDb } from './db';
import { baseName } from './terminalNameTag';

export type ArchivedMatch = {
  id: string;
  name: string;       // current tagged name, e.g. "[A-2] terminal3"
  base: string;       // "terminal3"
  handle: string | null;
  last_seen: number;  // terminals.updated_at (unix seconds)
};

/**
 * Archived terminals whose BASE name equals `base`. Drives the register
 * revive-vs-fresh decision. Handle is pulled from the matching
 * terminal_records row (session_id === terminals.id) when present.
 */
export function listArchivedMatchesForBase(base: string): ArchivedMatch[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT t.id, t.name, t.updated_at, tr.handle
       FROM terminals t
       LEFT JOIN terminal_records tr ON tr.session_id = t.id
      WHERE t.status = 'archived' AND t.name LIKE '[A%] ' || ?
      ORDER BY t.updated_at DESC`
  ).all(base) as Array<{ id: string; name: string; updated_at: number; handle: string | null }>;
  return rows
    .filter((r) => baseName(r.name) === base)
    .map((r) => ({ id: r.id, name: r.name, base, handle: r.handle, last_seen: r.updated_at }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/server/archivedNameMatches.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the endpoint integration test**

```typescript
// src/routes/api/identity/register/serverReviveFresh.test.ts
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { upsertTerminal, setTerminalStatus, getTerminalById, getLiveTerminalByName } from '$lib/server/terminalsStore';
import { resetIdentityDbForTests } from '$lib/server/db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-revfresh-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Minimal request builder — mirror the field names the existing
// register tests use in src/routes/api/identity/register/server.test.ts.
function reqWith(body: Record<string, unknown>) {
  return {
    request: new Request('http://localhost/api/identity/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

describe('register revive/fresh', () => {
  it('returns 409 archived_name_matches when an archived match exists and no intent flag', async () => {
    const a = upsertTerminal({ pid: 830001, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');
    const res = await POST(reqWith({ name: 'terminal3', pid: 830009, pid_start: 'fresh-shell' }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('archived_name_matches');
    expect(json.candidates.map((c: { id: string }) => c.id)).toContain(a.id);
  });

  it('fresh:true creates a new live terminal and leaves the archive tagged', async () => {
    const a = upsertTerminal({ pid: 830101, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');
    const res = await POST(reqWith({ name: 'terminal3', pid: 830109, pid_start: 'fresh-shell', fresh: true }));
    expect(res.status).toBe(200);
    expect(getTerminalById(a.id)?.name).toBe('[A] terminal3');     // archive untouched
    expect(getLiveTerminalByName('terminal3')?.id).not.toBe(a.id); // fresh row owns base
  });

  it('revive:<id> un-archives the chosen history row', async () => {
    const a = upsertTerminal({ pid: 830201, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');
    const res = await POST(reqWith({ name: 'terminal3', pid: 830209, pid_start: 'reused', revive: a.id }));
    expect(res.status).toBe(200);
    expect(getTerminalById(a.id)?.name).toBe('terminal3');
    expect(getTerminalById(a.id)?.status).toBe('live');
  });
});
```

> Before running, open `src/routes/api/identity/register/server.test.ts` and copy its EXACT request-construction + leaf-pid field names (the endpoint reads a PID chain; the example above uses flat `pid`/`pid_start` — match whatever the existing passing tests send, e.g. a `pid_chain` array). Align `reqWith` accordingly.

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/routes/api/identity/register/serverReviveFresh.test.ts`
Expected: FAIL — no `archived_name_matches` branch yet (returns 200 or merges).

- [ ] **Step 7: Implement the endpoint branch**

In `src/routes/api/identity/register/+server.ts`, add to the imports block (near line 16-24, the `$lib/server/terminalsStore` import):

```typescript
import { setTerminalStatus } from '$lib/server/terminalsStore';
import { listArchivedMatchesForBase } from '$lib/server/archivedNameMatches';
```

Read the two new optional intent fields near where `rawBody`/`nameRaw` are parsed (alongside `handleRaw`, ~line 124):

```typescript
  const reviveId = typeof rawBody.revive === 'string' && rawBody.revive.trim().length > 0
    ? rawBody.revive.trim() : null;
  const freshIntent = rawBody.fresh === true;
```

Insert this block AFTER the `pidConflict` check (after line 182) and BEFORE the handle-uniqueness block (line 199). It only acts when the caller is NOT a known v0.2 agent (reclaim takes precedence):

```typescript
  // Archived-name decision (spec 2026-05-31). The base name is free of any
  // LIVE terminal at this point (liveNameConflict above guards that), but
  // archived history rows may hold it under an [A] tag. If the caller gave
  // an explicit intent we honour it; otherwise we surface the ambiguity as
  // a structured 409 so the CLI can prompt (or fail loud when non-TTY).
  if (!knownV02Agent) {
    if (reviveId) {
      const target = getTerminalById(reviveId);
      if (!target || target.status !== 'archived' || baseName(target.name) !== trimmedName) {
        throw error(409, `Cannot revive ${reviveId}: not an archived terminal whose base name is '${trimmedName}'.`);
      }
      // Restore base name + flip live (chokepoint handles the rename).
      setTerminalStatus(reviveId, 'live');
      // Fall through to the normal upsert: name === trimmedName now, so
      // upsertTerminal UPDATEs the revived row, rebinding pid/pid_start/ttl.
    } else if (!freshIntent) {
      const candidates = listArchivedMatchesForBase(trimmedName);
      if (candidates.length > 0) {
        return json(
          {
            error: 'archived_name_matches',
            message: `Name '${trimmedName}' has ${candidates.length} archived terminal(s). Pass revive:<id> or fresh:true.`,
            candidates
          },
          { status: 409 }
        );
      }
    }
    // freshIntent === true falls straight through to the INSERT path.
  }
```

Add the `baseName` import (`$lib/server/terminalNameTag`). Ensure `getTerminalById` is imported (it is already used at line 206).

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/routes/api/identity/register/serverReviveFresh.test.ts`
Expected: PASS (all 3).

- [ ] **Step 9: Run the existing register suite for regressions**

Run: `npx vitest run src/routes/api/identity/register/server.test.ts`
Expected: PASS. Plain registers with no archived matches are unaffected (the new block is a no-op when `candidates` is empty).

- [ ] **Step 10: Commit**

```bash
git add src/lib/server/archivedNameMatches.ts src/lib/server/archivedNameMatches.test.ts src/routes/api/identity/register/+server.ts src/routes/api/identity/register/serverReviveFresh.test.ts
git commit -m "feat(register): archived-name 409 + revive/fresh intent"
```

---

## Task 5: CLI — prompt on TTY, fail loud when non-interactive

`ant register` interprets the 409 `archived_name_matches`: prompt when interactive, exit non-zero with the recovery list when not.

**Files:**
- Modify: `scripts/ant-cli-register.mjs` (the `register` verb, ~lines 128-166)
- Test: `scripts/ant-cli-register.archived.test.mjs` (new — uses the injected `runtime` seam)

- [ ] **Step 1: Inspect the runtime seam**

Read `scripts/ant-cli-register.mjs` lines 60-166 to confirm the `runtime` object shape (`fetchImpl`, `writeOut`, `writeErr`, `flags`, `serverUrl`). Add two seams used by the new code so tests can inject them: `runtime.isInteractive` (default `process.stdin.isTTY === true`) and `runtime.promptImpl` (default a `node:readline/promises` question). Confirm where `runtime` is constructed (search for `fetchImpl:` / `writeOut:`), and add the two defaults there.

- [ ] **Step 2: Write the failing test**

```javascript
// scripts/ant-cli-register.archived.test.mjs
import { describe, expect, it } from 'vitest';
import { runRegister } from './ant-cli-register.mjs'; // export it if not already

function fakeRuntime(overrides = {}) {
  const out = [];
  const err = [];
  return {
    serverUrl: 'http://localhost:6174',
    flags: { name: 'terminal3' },
    writeOut: (s) => out.push(s),
    writeErr: (s) => err.push(s),
    isInteractive: false,
    promptImpl: async () => 'f',
    out, err,
    ...overrides
  };
}

const ARCHIVED_409 = {
  status: 409,
  json: async () => ({
    error: 'archived_name_matches',
    candidates: [{ id: 'term-a', name: '[A] terminal3', base: 'terminal3', handle: '@v4', last_seen: 1 }]
  }),
  text: async () => ''
};

describe('register archived_name_matches handling', () => {
  it('non-interactive: prints recovery list and throws (fail loud, no silent fresh)', async () => {
    const rt = fakeRuntime({ isInteractive: false, fetchImpl: async () => ARCHIVED_409 });
    await expect(runRegister(rt)).rejects.toThrow(/archived/i);
    expect(rt.err.join('\n')).toMatch(/--revive|--fresh/);
    expect(rt.err.join('\n')).toMatch(/term-a/);
  });

  it('interactive + choose fresh: re-POSTs with fresh:true', async () => {
    const bodies = [];
    const rt = fakeRuntime({
      isInteractive: true,
      promptImpl: async () => 'f',
      fetchImpl: async (_url, opts) => {
        const body = JSON.parse(opts.body);
        bodies.push(body);
        if (!body.fresh && !body.revive) return ARCHIVED_409;
        return { status: 200, json: async () => ({ name: 'terminal3', terminal_id: 'new-1' }), text: async () => '' };
      }
    });
    await runRegister(rt);
    expect(bodies.at(-1).fresh).toBe(true);
  });

  it('interactive + choose revive: re-POSTs with revive:<id>', async () => {
    const bodies = [];
    const rt = fakeRuntime({
      isInteractive: true,
      promptImpl: async () => '1', // pick candidate #1
      fetchImpl: async (_url, opts) => {
        const body = JSON.parse(opts.body);
        bodies.push(body);
        if (!body.fresh && !body.revive) return ARCHIVED_409;
        return { status: 200, json: async () => ({ name: 'terminal3', terminal_id: 'term-a' }), text: async () => '' };
      }
    });
    await runRegister(rt);
    expect(bodies.at(-1).revive).toBe('term-a');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run scripts/ant-cli-register.archived.test.mjs`
Expected: FAIL — `runRegister` not exported / no archived handling.

- [ ] **Step 4: Implement the CLI handling**

In `scripts/ant-cli-register.mjs`, after the primary register POST (`primaryResp`, ~line 156), branch on the structured 409 BEFORE the existing success path. Replace the block from the POST to the success `writeOut` with:

```javascript
  let primaryResp = await postJson(runtime, `${runtime.serverUrl}/api/identity/register`, registerBody);

  // Archived base-name collision: server asks us to choose revive vs fresh.
  if (primaryResp.status === 409) {
    const payload = await primaryResp.json().catch(() => null);
    if (payload && payload.error === 'archived_name_matches') {
      const candidates = payload.candidates || [];
      if (!runtime.isInteractive) {
        // FAIL LOUD — never silently pick fresh in a non-interactive context.
        runtime.writeErr(`Name '${registerBody.name}' has ${candidates.length} archived terminal(s):`);
        for (const c of candidates) {
          runtime.writeErr(`  ${c.id}  ${c.name}  ${c.handle ?? ''}`);
        }
        runtime.writeErr(`Re-run with --revive <id> (reuse one) or --fresh (new terminal).`);
        throw new CliInputError(`archived name '${registerBody.name}' needs --revive <id> or --fresh`);
      }
      // Interactive: prompt.
      runtime.writeOut(`Name '${registerBody.name}' has archived terminal(s):`);
      candidates.forEach((c, i) => runtime.writeOut(`  [${i + 1}] ${c.name}  ${c.handle ?? ''}  (id ${c.id})`));
      const answer = (await runtime.promptImpl('Revive which number, [f]resh, or [c]ancel? ')).trim().toLowerCase();
      if (answer === 'c' || answer === '') throw new CliInputError('register cancelled');
      if (answer === 'f') {
        registerBody.fresh = true;
      } else {
        const idx = Number(answer) - 1;
        const chosen = candidates[idx];
        if (!chosen) throw new CliInputError(`invalid choice '${answer}'`);
        registerBody.revive = chosen.id;
      }
      primaryResp = await postJson(runtime, `${runtime.serverUrl}/api/identity/register`, registerBody);
    }
  }

  if (primaryResp.status !== 200) {
    const text = await primaryResp.text();
    runtime.writeErr(`fresh-ANT register failed (${primaryResp.status}): ${text.slice(0, 200)}`);
    throw new CliInputError('register failed');
  }
  const primaryBody = await primaryResp.json();
  runtime.writeOut(`Registered ${primaryBody.name} as ${primaryBody.terminal_id} (fresh-ANT)`);
```

Wire `--revive` / `--fresh` flags into `registerBody` up front (near line 140) so an explicit flag skips the prompt entirely:

```javascript
  if (flags.revive) registerBody.revive = flags.revive;
  if (flags.fresh) registerBody.fresh = true;
```

Add the two runtime defaults where `runtime` is built:

```javascript
  isInteractive: process.stdin.isTTY === true,
  promptImpl: async (q) => {
    const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question(q); } finally { rl.close(); }
  },
```

Export `runRegister` if the verb body is currently an inline closure — extract it to a named exported `async function runRegister(runtime)`.

Update the usage banner (line 78) to mention `[--revive <id>] [--fresh]`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run scripts/ant-cli-register.archived.test.mjs`
Expected: PASS (3 cases).

- [ ] **Step 6: Commit**

```bash
git add scripts/ant-cli-register.mjs scripts/ant-cli-register.archived.test.mjs
git commit -m "feat(cli): register prompts revive/fresh on TTY, fails loud otherwise"
```

---

## Task 6: Recovery section in the projected MD, written to both paths

Add a `## Recoverable archived terminals` section and write the projection to both `~/Documents/ant-registry.md` (or its env override) AND the ObsidiANT vault.

**Files:**
- Modify: `src/lib/server/antRegistryFile.ts` (`buildAntRegistryMarkdown` ~line 30, `projectAntRegistryFile` ~line 114)
- Test: `src/lib/server/antRegistryRecovery.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/server/antRegistryRecovery.test.ts
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertTerminal, setTerminalStatus } from './terminalsStore';
import { buildAntRegistryMarkdown, projectAntRegistryFile } from './antRegistryFile';
import { writeMemoryVaultPath } from './memoryVaultSettingsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-recovery-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = join(tmpDir, 'vault');
  process.env.ANT_REGISTRY_FILE_PATH = join(tmpDir, 'ant-registry.md');
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ANT_REGISTRY_FILE_PATH;
});

describe('recovery section', () => {
  it('lists archived terminals with base name and a --revive command', () => {
    const a = upsertTerminal({ pid: 840001, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');
    const md = buildAntRegistryMarkdown();
    expect(md).toContain('## Recoverable archived terminals');
    expect(md).toContain('[A] terminal3');
    expect(md).toContain(`ant register --name terminal3 --revive ${a.id}`);
  });

  it('writes the projection to both the default path and the vault path', () => {
    const a = upsertTerminal({ pid: 840101, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');
    const result = projectAntRegistryFile({ force: true });
    expect(existsSync(process.env.ANT_REGISTRY_FILE_PATH!)).toBe(true);
    const vaultFile = join(process.env.ANT_MEMORY_VAULT_PATH!, 'ant-registry.md');
    expect(existsSync(vaultFile)).toBe(true);
    expect(readFileSync(vaultFile, 'utf8')).toContain('[A] terminal3');
    expect(result.path).toBeTruthy();
  });
});
```

> Confirm the resolver: `resolveMemoryVaultPath()` reads `ANT_MEMORY_VAULT_PATH` (env precedence) per `memoryVaultSettingsStore.ts:69-78`. If the env var name differs, align the test + impl.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/server/antRegistryRecovery.test.ts`
Expected: FAIL — no recovery section, vault file not written.

- [ ] **Step 3: Add the recovery section to `buildAntRegistryMarkdown`**

In `src/lib/server/antRegistryFile.ts`, add imports:

```typescript
import { baseName } from './terminalNameTag';
import { resolveMemoryVaultPath } from './memoryVaultSettingsStore';
```

Before the final `lines.push('')` / mirror comment (~line 76), insert:

```typescript
  // Recoverable archived terminals (spec 2026-05-31). Read directly from
  // `terminals` so this works as a cold-start reference even when the
  // server/daemon is down — open this file in Obsidian and run the command.
  const archived = getIdentityDb().prepare(
    `SELECT t.id, t.name, t.updated_at, tr.handle
       FROM terminals t
       LEFT JOIN terminal_records tr ON tr.session_id = t.id
      WHERE t.status = 'archived' AND t.name LIKE '[A%] %'
      ORDER BY t.updated_at DESC`
  ).all() as Array<{ id: string; name: string; updated_at: number; handle: string | null }>;
  if (archived.length > 0) {
    lines.push('');
    lines.push('## Recoverable archived terminals');
    lines.push('');
    lines.push('| Base name | Tag | Handle | Last seen | Recover |');
    lines.push('|---|---|---|---|---|');
    for (const row of archived) {
      const base = baseName(row.name);
      lines.push(`| ${[
        md(base),
        md(row.name),
        md(row.handle ?? ''),
        md(new Date((row.updated_at || 0) * 1000).toISOString()),
        md(`\`ant register --name ${base} --revive ${row.id}\``)
      ].join(' | ')} |`);
    }
  }
```

- [ ] **Step 4: Write the projection to both paths in `projectAntRegistryFile`**

Replace the single-write body of `projectAntRegistryFile` (lines 114-124) with a two-target write. Each target is independent so one failing does not skip the other:

```typescript
export function projectAntRegistryFile(options: { force?: boolean } = {}): AntRegistryProjectionResult {
  const path = antRegistryFilePath();
  if (!options.force && process.env.NODE_ENV === 'test' && !process.env.ANT_REGISTRY_FILE_PATH && !process.env.ANT_AGENT_REGISTRY_PATH) {
    return { path, rows: 0, skipped: true };
  }
  const content = buildAntRegistryMarkdown();
  const targets = [path];
  // Second target: the ObsidiANT / user-defined vault, so the recovery
  // reference lives where the user already reads memories. Unset vault =>
  // only the default path is written (no error).
  const vault = resolveMemoryVaultPath();
  if (vault && vault.trim().length > 0) {
    targets.push(join(vault.trim(), 'ant-registry.md'));
  }
  for (const target of targets) {
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    } catch {
      // Independent best-effort per target — one failing must not skip the
      // other, and neither may block terminal routing (see BestEffort wrapper).
    }
  }
  const rows = content.split('\n').filter((line) => line.startsWith('| ') && !line.includes('---')).length - 1;
  return { path, rows: Math.max(0, rows), skipped: false };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/server/antRegistryRecovery.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Run the existing registry-file suite for regressions**

Run: `npx vitest run src/lib/server/antRegistryFile.test.ts`
Expected: PASS (skip-in-test guard and existing table output are preserved). If no such test file exists, skip this step.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/antRegistryFile.ts src/lib/server/antRegistryRecovery.test.ts
git commit -m "feat(registry): recovery section + dual-path projection (default + vault)"
```

---

## Task 7: Backfill existing archived squatters

A one-shot, idempotent pass tags already-archived rows whose name is still untagged, freeing their base names immediately. Wired into DB init (best-effort) so it runs on rollout without an operator step.

**Files:**
- Add: `backfillArchivedTerminalTags()` in `src/lib/server/terminalsStore.ts`
- Modify: `src/lib/server/db.ts` (~line 2505, after the `V02_SCHEMA_DDL_STATEMENTS` loop in the migrate function)
- Test: `src/lib/server/backfillArchivedTags.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/server/backfillArchivedTags.test.ts
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb } from './db';
import { upsertTerminal, getTerminalById, backfillArchivedTerminalTags } from './terminalsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-backfill-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Force a row into the legacy state: archived but UNTAGGED name, simulating
// a terminal archived before this feature shipped.
function archiveUntagged(id: string) {
  getIdentityDb().prepare(`UPDATE terminals SET status = 'archived' WHERE id = ?`).run(id);
}

describe('backfillArchivedTerminalTags', () => {
  it('tags archived squatters and frees their base name', () => {
    const a = upsertTerminal({ pid: 850001, pid_start: 'a', name: 'terminal3' });
    archiveUntagged(a.id);
    const tagged = backfillArchivedTerminalTags();
    expect(tagged).toBe(1);
    expect(getTerminalById(a.id)?.name).toBe('[A] terminal3');
  });

  it('assigns per-base sequence across multiple squatters', () => {
    const a = upsertTerminal({ pid: 850101, pid_start: 'a', name: 'terminal3' });
    archiveUntagged(a.id);
    backfillArchivedTerminalTags(); // a -> [A] terminal3
    const b = upsertTerminal({ pid: 850102, pid_start: 'b', name: 'terminal3' });
    archiveUntagged(b.id);
    backfillArchivedTerminalTags(); // b -> [A-2] terminal3
    expect(getTerminalById(b.id)?.name).toBe('[A-2] terminal3');
  });

  it('is idempotent — a second run tags nothing', () => {
    const a = upsertTerminal({ pid: 850201, pid_start: 'a', name: 'terminal3' });
    archiveUntagged(a.id);
    expect(backfillArchivedTerminalTags()).toBe(1);
    expect(backfillArchivedTerminalTags()).toBe(0);
  });

  it('leaves live terminals untouched', () => {
    const live = upsertTerminal({ pid: 850301, pid_start: 'a', name: 'terminal3' });
    backfillArchivedTerminalTags();
    expect(getTerminalById(live.id)?.name).toBe('terminal3');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/server/backfillArchivedTags.test.ts`
Expected: FAIL — `backfillArchivedTerminalTags` not exported.

- [ ] **Step 3: Implement the backfill**

Append to `src/lib/server/terminalsStore.ts`:

```typescript
/**
 * One-shot, idempotent backfill (spec 2026-05-31): tag every already-archived
 * terminal whose name is still untagged, so legacy squatters free their base
 * name immediately rather than only on the next archive. Reuses the
 * setTerminalStatus chokepoint per row, which also vacates the matching
 * terminal_records name. Returns the number of rows tagged. Re-running is a
 * no-op (no archived+untagged rows remain), so it is safe to call on every
 * boot. Already-tagged archives are skipped.
 */
export function backfillArchivedTerminalTags(): number {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT id, name FROM terminals WHERE status = 'archived'`
  ).all() as Array<{ id: string; name: string }>;
  let tagged = 0;
  for (const row of rows) {
    if (isTagged(row.name)) continue;
    // Re-flip to archived through the chokepoint: it tags the (still
    // untagged) name and assigns the next free per-base sequence.
    setTerminalStatus(row.id, 'archived');
    tagged++;
  }
  return tagged;
}
```

(`isTagged` is already imported from Task 2.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/server/backfillArchivedTags.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Wire into DB init (best-effort)**

In `src/lib/server/db.ts`, immediately after the `V02_SCHEMA_DDL_STATEMENTS` migration loop (after line ~2505, before `return db`/end of the migrate function), add a guarded call. Import lazily to avoid a module cycle (db.ts ↔ terminalsStore.ts):

```typescript
  // One-shot archived-name backfill (spec 2026-05-31). Idempotent + cheap
  // (single SELECT when nothing to do). Best-effort: a failure here must
  // never stop getIdentityDb() from completing, or every API route 500s.
  try {
    const { backfillArchivedTerminalTags } = require('./terminalsStore');
    backfillArchivedTerminalTags();
  } catch {
    /* never block DB init on the backfill */
  }
```

> If the file is ESM-only and `require` is unavailable, instead export a `runArchivedTagBackfill()` from terminalsStore and call it once from `src/hooks.server.ts` startup. Pick whichever matches the file's module system — check the top of `db.ts` for `require` vs `import` usage before choosing.

- [ ] **Step 6: Run the full server-lib suite to confirm init still works**

Run: `npx vitest run src/lib/server/terminalLifecycle.test.ts src/lib/server/terminalNameVacate.test.ts`
Expected: PASS — init runs the backfill on an empty DB (no-op) without throwing.

- [ ] **Step 7: Typecheck the whole change**

Run: `npm run check`
Expected: no new errors in the touched files.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/terminalsStore.ts src/lib/server/backfillArchivedTags.test.ts src/lib/server/db.ts
git commit -m "feat(terminals): one-shot backfill of archived-name tags on init"
```

---

## Final verification

- [ ] Run every new + touched suite together:

```bash
npx vitest run \
  src/lib/server/terminalNameTag.test.ts \
  src/lib/server/terminalNameVacate.test.ts \
  src/lib/server/archivePathsVacateName.test.ts \
  src/lib/server/archivedNameMatches.test.ts \
  src/routes/api/identity/register/serverReviveFresh.test.ts \
  src/routes/api/identity/register/server.test.ts \
  src/lib/server/antRegistryRecovery.test.ts \
  src/lib/server/backfillArchivedTags.test.ts \
  src/lib/server/terminalLifecycle.test.ts \
  'src/routes/api/chat-rooms/[roomId]/members/[handle]/reclaim/server.test.ts'
```
Expected: all PASS.

- [ ] `npm run check` — clean.
- [ ] Manual smoke (server running on :6174): archive a test terminal, confirm its name shows `[A] …` in `/terminals` and in the recovery section of both `~/Documents/ant-registry.md` and the vault copy; `ant register --name <freed>` prompts revive/fresh; the same command piped non-interactively exits non-zero with the recovery list.

---

## Self-review notes (author)

- **Spec coverage:** scheme→Task 1; eager chokepoint rename→Task 2; raw-SQL paths→Task 3; revive/fresh + fail-loud→Tasks 4-5; terminal_records parity→Task 2 (folded into the chokepoint, keyed by session_id===id); offline reference both-paths→Task 6; backfill→Task 7. All eight decisions mapped.
- **Open verification items flagged inline (not gaps):** exact register-test request shape (Task 4 Step 5), `addMembership` signature (Task 3), `resolveMemoryVaultPath` env-var name (Task 6), and db.ts module system for the backfill wiring (Task 7 Step 5). Each has a concrete "confirm against <file>" instruction.
- **Type consistency:** helper names (`baseName`, `isTagged`, `parseArchiveSeq`, `tagArchivedName`, `nextArchiveSeq`) are used identically across Tasks 1-7; `setTerminalStatus` keeps its `(id, status) => boolean` signature; `ArchivedMatch.id/name/base/handle/last_seen` shape matches the CLI candidate fields and the recovery-section columns.
