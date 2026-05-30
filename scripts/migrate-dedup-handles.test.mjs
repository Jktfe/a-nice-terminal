/**
 * migrate-dedup-handles tests — Fix #2 of sec-iter1 (2026-05-30
 * enterprise security pass). Asserts the one-shot dedup migration
 * correctly identifies + NULLifies older duplicate handles so the
 * UNIQUE INDEX `terminal_records_handle_unique` can be created without
 * a SQLITE_CONSTRAINT failure.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  findDuplicateHandles,
  rowsForDuplicateHandle,
  planDedup,
  applyDedup
} from './migrate-dedup-handles.mjs';

let db;

function createSchema() {
  db.exec(`
    CREATE TABLE terminal_records (
      session_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT,
      superseded_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
}

function insert(row) {
  db.prepare(
    `INSERT INTO terminal_records (session_id, name, handle, superseded_at_ms, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.session_id,
    row.name ?? row.session_id,
    row.handle ?? null,
    row.superseded_at_ms ?? null,
    row.created_at_ms ?? 1000,
    row.updated_at_ms ?? 1000
  );
}

beforeEach(() => {
  db = new Database(':memory:');
  createSchema();
});

afterEach(() => {
  db.close();
});

describe('findDuplicateHandles', () => {
  it('returns empty array when no duplicates', () => {
    insert({ session_id: 's1', handle: '@alice', created_at_ms: 1000 });
    insert({ session_id: 's2', handle: '@bob', created_at_ms: 1001 });
    expect(findDuplicateHandles(db)).toEqual([]);
  });

  it('returns the duplicated handle with its count', () => {
    insert({ session_id: 's1', handle: '@alice', created_at_ms: 1000 });
    insert({ session_id: 's2', handle: '@alice', created_at_ms: 2000 });
    insert({ session_id: 's3', handle: '@bob', created_at_ms: 3000 });
    const dupes = findDuplicateHandles(db);
    expect(dupes).toEqual([{ handle: '@alice', cnt: 2 }]);
  });

  it('ignores superseded rows when counting duplicates', () => {
    insert({ session_id: 's1', handle: '@alice', created_at_ms: 1000 });
    insert({ session_id: 's2', handle: '@alice', superseded_at_ms: 999, created_at_ms: 2000 });
    expect(findDuplicateHandles(db)).toEqual([]);
  });

  it('ignores NULL and empty handles', () => {
    insert({ session_id: 's1', handle: null, created_at_ms: 1000 });
    insert({ session_id: 's2', handle: null, created_at_ms: 1001 });
    insert({ session_id: 's3', handle: '', created_at_ms: 1002 });
    insert({ session_id: 's4', handle: '', created_at_ms: 1003 });
    expect(findDuplicateHandles(db)).toEqual([]);
  });

  it('returns multiple duplicate handles ordered by count desc', () => {
    insert({ session_id: 'a1', handle: '@alice', created_at_ms: 1000 });
    insert({ session_id: 'a2', handle: '@alice', created_at_ms: 2000 });
    insert({ session_id: 'a3', handle: '@alice', created_at_ms: 3000 });
    insert({ session_id: 'b1', handle: '@bob', created_at_ms: 1000 });
    insert({ session_id: 'b2', handle: '@bob', created_at_ms: 2000 });
    const dupes = findDuplicateHandles(db);
    expect(dupes[0]).toEqual({ handle: '@alice', cnt: 3 });
    expect(dupes[1]).toEqual({ handle: '@bob', cnt: 2 });
  });
});

describe('rowsForDuplicateHandle', () => {
  it('returns rows newest-first', () => {
    insert({ session_id: 's1', name: 'old', handle: '@alice', created_at_ms: 1000 });
    insert({ session_id: 's2', name: 'new', handle: '@alice', created_at_ms: 2000 });
    const rows = rowsForDuplicateHandle(db, '@alice');
    expect(rows.map((r) => r.session_id)).toEqual(['s2', 's1']);
  });

  it('tiebreaks by session_id desc on equal created_at_ms', () => {
    insert({ session_id: 's_a', handle: '@dup', created_at_ms: 1000 });
    insert({ session_id: 's_b', handle: '@dup', created_at_ms: 1000 });
    const rows = rowsForDuplicateHandle(db, '@dup');
    expect(rows.map((r) => r.session_id)).toEqual(['s_b', 's_a']);
  });

  it('excludes superseded rows', () => {
    insert({ session_id: 's1', handle: '@alice', created_at_ms: 1000 });
    insert({
      session_id: 's2',
      handle: '@alice',
      superseded_at_ms: 999,
      created_at_ms: 2000
    });
    const rows = rowsForDuplicateHandle(db, '@alice');
    expect(rows.map((r) => r.session_id)).toEqual(['s1']);
  });
});

describe('planDedup', () => {
  it('returns empty plan when no duplicates', () => {
    insert({ session_id: 's1', handle: '@alice', created_at_ms: 1000 });
    const plan = planDedup(db);
    expect(plan.duplicateHandleCount).toBe(0);
    expect(plan.toNullify).toEqual([]);
  });

  it('queues older rows for NULLify, keeps newest', () => {
    insert({ session_id: 'old', handle: '@alice', created_at_ms: 1000 });
    insert({ session_id: 'mid', handle: '@alice', created_at_ms: 2000 });
    insert({ session_id: 'new', handle: '@alice', created_at_ms: 3000 });
    const plan = planDedup(db);
    expect(plan.duplicateHandleCount).toBe(1);
    expect(plan.toNullify.map((r) => r.session_id).sort()).toEqual(['mid', 'old']);
  });

  it('handles multiple duplicate handles independently', () => {
    insert({ session_id: 'a1', handle: '@a', created_at_ms: 1000 });
    insert({ session_id: 'a2', handle: '@a', created_at_ms: 2000 });
    insert({ session_id: 'b1', handle: '@b', created_at_ms: 1000 });
    insert({ session_id: 'b2', handle: '@b', created_at_ms: 2000 });
    const plan = planDedup(db);
    expect(plan.duplicateHandleCount).toBe(2);
    expect(plan.toNullify.map((r) => r.session_id).sort()).toEqual(['a1', 'b1']);
  });
});

describe('applyDedup', () => {
  it('NULLifies the queued rows and updates updated_at_ms', () => {
    insert({ session_id: 'keep', handle: '@alice', created_at_ms: 2000, updated_at_ms: 2000 });
    insert({ session_id: 'old', handle: '@alice', created_at_ms: 1000, updated_at_ms: 1000 });
    const { toNullify } = planDedup(db);
    const updated = applyDedup(db, toNullify, 5000);
    expect(updated).toBe(1);
    const keep = db.prepare(`SELECT handle FROM terminal_records WHERE session_id = ?`).get('keep');
    expect(keep.handle).toBe('@alice');
    const old = db.prepare(`SELECT handle, updated_at_ms FROM terminal_records WHERE session_id = ?`).get('old');
    expect(old.handle).toBeNull();
    expect(old.updated_at_ms).toBe(5000);
  });

  it('is idempotent — re-running over deduped data is a no-op', () => {
    insert({ session_id: 'keep', handle: '@alice', created_at_ms: 2000 });
    insert({ session_id: 'old', handle: '@alice', created_at_ms: 1000 });
    applyDedup(db, planDedup(db).toNullify);
    // Second pass finds no duplicates.
    const plan2 = planDedup(db);
    expect(plan2.toNullify).toEqual([]);
    expect(applyDedup(db, plan2.toNullify)).toBe(0);
  });

  it('returns 0 when nothing to nullify', () => {
    expect(applyDedup(db, [])).toBe(0);
  });

  it('after applying, the UNIQUE INDEX can be created without throwing', () => {
    insert({ session_id: 'keep', handle: '@alice', created_at_ms: 2000 });
    insert({ session_id: 'old', handle: '@alice', created_at_ms: 1000 });
    insert({ session_id: 'b', handle: '@bob', created_at_ms: 1500 });
    applyDedup(db, planDedup(db).toNullify);
    expect(() =>
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS terminal_records_handle_unique
          ON terminal_records(handle)
          WHERE handle IS NOT NULL AND handle != '' AND superseded_at_ms IS NULL
      `)
    ).not.toThrow();
  });
});
