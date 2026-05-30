/**
 * migrate-purge-reserved-handles tests — Sec-iter2 Fix #4 of the
 * 2026-05-30 enterprise security pass. Asserts the one-shot reserved-
 * handle purge correctly identifies the offending rows, NULLs the
 * handle column, leaves the rest of the row untouched, and logs to
 * audit_events when that table exists.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadReservedHandles,
  findReservedHandleRows,
  applyPurge,
  auditEventsTableExists
} from './migrate-purge-reserved-handles.mjs';

let db;
let tmpDir;
let reservedPath;

function createSchema(withAudit = true) {
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
  if (withAudit) {
    db.exec(`
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        actor_handle TEXT,
        created_at_ms INTEGER NOT NULL,
        before_json TEXT,
        after_json TEXT
      );
    `);
  }
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
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-purge-reserved-'));
  reservedPath = join(tmpDir, 'reserved-handles.json');
  writeFileSync(
    reservedPath,
    JSON.stringify(['@admin', '@you', '@everyone', '@chair', '@system'])
  );
  createSchema();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadReservedHandles', () => {
  it('reads the JSON file at the override path', () => {
    const list = loadReservedHandles(reservedPath);
    expect(list).toContain('@admin');
    expect(list).toContain('@you');
    expect(list).toHaveLength(5);
  });

  it('throws when the file is missing at every candidate path', () => {
    expect(() => loadReservedHandles(join(tmpDir, 'does-not-exist.json'))).toThrow();
  });
});

describe('findReservedHandleRows', () => {
  it('returns rows whose handle matches a reserved entry (case-sensitive exact)', () => {
    insert({ session_id: 's_admin', handle: '@admin', created_at_ms: 1000 });
    insert({ session_id: 's_legit', handle: '@alice', created_at_ms: 1100 });
    const rows = findReservedHandleRows(db, ['@admin', '@you']);
    expect(rows.map((r) => r.session_id)).toEqual(['s_admin']);
  });

  it('is case-insensitive — @ADMIN / @Admin / @admin all match', () => {
    insert({ session_id: 's1', handle: '@ADMIN', created_at_ms: 1000 });
    insert({ session_id: 's2', handle: '@Admin', created_at_ms: 1100 });
    insert({ session_id: 's3', handle: '@admin', created_at_ms: 1200 });
    insert({ session_id: 's4', handle: '@aDmIn', created_at_ms: 1300 });
    const rows = findReservedHandleRows(db, ['@admin']);
    expect(rows.map((r) => r.session_id).sort()).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('returns newest-first ordering', () => {
    insert({ session_id: 's_old', handle: '@admin', created_at_ms: 1000 });
    insert({ session_id: 's_new', handle: '@admin', created_at_ms: 2000 });
    const rows = findReservedHandleRows(db, ['@admin']);
    expect(rows.map((r) => r.session_id)).toEqual(['s_new', 's_old']);
  });

  it('returns empty array when no rows match', () => {
    insert({ session_id: 's1', handle: '@alice', created_at_ms: 1000 });
    insert({ session_id: 's2', handle: '@bob', created_at_ms: 1100 });
    expect(findReservedHandleRows(db, ['@admin'])).toEqual([]);
  });

  it('ignores NULL + empty handles even if reserved list is non-empty', () => {
    insert({ session_id: 's1', handle: null, created_at_ms: 1000 });
    insert({ session_id: 's2', handle: '', created_at_ms: 1100 });
    expect(findReservedHandleRows(db, ['@admin'])).toEqual([]);
  });

  it('captures the superseded flag on each row', () => {
    insert({ session_id: 's_active', handle: '@admin', created_at_ms: 2000 });
    insert({ session_id: 's_stale', handle: '@admin', superseded_at_ms: 1500, created_at_ms: 1000 });
    const rows = findReservedHandleRows(db, ['@admin']);
    const active = rows.find((r) => r.session_id === 's_active');
    const stale = rows.find((r) => r.session_id === 's_stale');
    expect(active?.superseded_at_ms).toBeNull();
    expect(stale?.superseded_at_ms).toBe(1500);
  });
});

describe('applyPurge', () => {
  it('NULLs the handle column on the queued rows', () => {
    insert({ session_id: 's1', handle: '@admin', created_at_ms: 1000, updated_at_ms: 1000 });
    insert({ session_id: 's2', handle: '@alice', created_at_ms: 1100 });
    const rows = findReservedHandleRows(db, ['@admin']);
    const count = applyPurge(db, rows, true, 5000);
    expect(count).toBe(1);
    const after = db.prepare(`SELECT handle, updated_at_ms FROM terminal_records WHERE session_id = ?`).get('s1');
    expect(after.handle).toBeNull();
    expect(after.updated_at_ms).toBe(5000);
    // Untouched row should be unchanged.
    const legit = db.prepare(`SELECT handle FROM terminal_records WHERE session_id = ?`).get('s2');
    expect(legit.handle).toBe('@alice');
  });

  it('writes an audit_events row with the prior handle in after_json', () => {
    insert({ session_id: 's_audit', handle: '@admin', created_at_ms: 1000 });
    const rows = findReservedHandleRows(db, ['@admin']);
    applyPurge(db, rows, true, 5000);
    const audit = db.prepare(
      `SELECT kind, entity_kind, entity_id, actor_handle, after_json FROM audit_events`
    ).get();
    expect(audit).toBeDefined();
    expect(audit.kind).toBe('terminal_record.handle_purged_reserved');
    expect(audit.entity_kind).toBe('terminal_record');
    expect(audit.entity_id).toBe('s_audit');
    expect(audit.actor_handle).toBe('@migration');
    const parsed = JSON.parse(audit.after_json);
    expect(parsed.prior_handle).toBe('@admin');
    expect(parsed.reason).toContain('sec-iter2 fix #4');
  });

  it('skips audit writes when the audit_events table is missing', () => {
    db.close();
    db = new Database(':memory:');
    createSchema(/* withAudit */ false);
    insert({ session_id: 's_no_audit', handle: '@admin', created_at_ms: 1000 });
    const rows = findReservedHandleRows(db, ['@admin']);
    const count = applyPurge(db, rows, false, 5000);
    expect(count).toBe(1);
    // Row still purged.
    const after = db.prepare(`SELECT handle FROM terminal_records WHERE session_id = ?`).get('s_no_audit');
    expect(after.handle).toBeNull();
    // No audit_events table — confirm via sqlite_master.
    const hasAudit = auditEventsTableExists(db);
    expect(hasAudit).toBe(false);
  });

  it('is idempotent — re-running over a purged DB is a no-op', () => {
    insert({ session_id: 's_idem', handle: '@admin', created_at_ms: 1000 });
    const rows1 = findReservedHandleRows(db, ['@admin']);
    applyPurge(db, rows1, true);
    const rows2 = findReservedHandleRows(db, ['@admin']);
    expect(rows2).toEqual([]);
    const count2 = applyPurge(db, rows2, true);
    expect(count2).toBe(0);
  });

  it('returns 0 when nothing to purge', () => {
    expect(applyPurge(db, [], true)).toBe(0);
  });

  it('preserves the session_id so foreign-key references stay intact', () => {
    // Mimics the spec's structural constraint: we NULL the handle, not
    // delete the row, so chat_rooms / room_memberships / audit history
    // referencing this session_id keep working.
    insert({ session_id: 's_ref', name: 'still-here', handle: '@admin', created_at_ms: 1000 });
    const rows = findReservedHandleRows(db, ['@admin']);
    applyPurge(db, rows, true);
    const after = db.prepare(`SELECT session_id, name FROM terminal_records WHERE session_id = ?`).get('s_ref');
    expect(after).toBeDefined();
    expect(after.session_id).toBe('s_ref');
    expect(after.name).toBe('still-here');
  });

  it('purges every reserved handle in a single transaction', () => {
    insert({ session_id: 's_admin', handle: '@admin', created_at_ms: 1000 });
    insert({ session_id: 's_you', handle: '@you', created_at_ms: 1100 });
    insert({ session_id: 's_chair', handle: '@chair', created_at_ms: 1200 });
    insert({ session_id: 's_legit', handle: '@alice', created_at_ms: 1300 });
    const rows = findReservedHandleRows(db, ['@admin', '@you', '@everyone', '@chair', '@system']);
    expect(rows).toHaveLength(3);
    const count = applyPurge(db, rows, true);
    expect(count).toBe(3);
    // Audit log should reflect every purge.
    const auditCount = db.prepare(`SELECT COUNT(*) AS c FROM audit_events`).get().c;
    expect(auditCount).toBe(3);
    // Legit row untouched.
    const legit = db.prepare(`SELECT handle FROM terminal_records WHERE session_id = ?`).get('s_legit');
    expect(legit.handle).toBe('@alice');
  });
});

describe('auditEventsTableExists', () => {
  it('returns true when the table is present', () => {
    expect(auditEventsTableExists(db)).toBe(true);
  });

  it('returns false when the table is absent', () => {
    db.close();
    db = new Database(':memory:');
    createSchema(false);
    expect(auditEventsTableExists(db)).toBe(false);
  });
});
