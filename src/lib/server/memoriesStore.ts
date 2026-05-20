/**
 * Persisted store for the memory CRUD subsystem (MEMORY-CRUD 2026-05-16).
 *
 * Sits underneath the existing read-only /api/memory-recall semantic-search
 * endpoint. Every mutation (put/update/delete) writes a memory_audit row so
 * history survives — JWPK soft-evidence pattern for the load-bearing
 * subsystem the v3 dashboard uses most.
 *
 * Key model:
 *   - `key` is a slash-delimited identity ("agents/researchant/role"); UNIQUE.
 *   - `put` is upsert-by-key: if the key exists already, value/last_updated_by
 *     are overwritten and `action = 'update'` is recorded in audit. If not,
 *     a fresh row is inserted and `action = 'put'` is recorded.
 *   - `scope` is one of 'global' (default) | 'terminal' | 'room'. Stored
 *     as NULL when 'global' so historical rows without a scope still read
 *     correctly. `scope_target` carries the terminalId or roomId.
 *
 * Per chatRoomStore pattern: better-sqlite3 + globalThis singleton via
 * getIdentityDb. resetMemoriesStoreForTests truncates both tables.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type MemoryScope = 'global' | 'terminal' | 'room';

export type MemoryRecord = {
  id: string;
  key: string;
  value: string;
  scope: MemoryScope;
  scopeTarget: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  createdBy: string | null;
  lastUpdatedBy: string | null;
};

export type MemoryAuditEntry = {
  id: number;
  memoryKey: string;
  action: 'put' | 'delete' | 'update';
  prevValue: string | null;
  newValue: string | null;
  byHandle: string | null;
  atMs: number;
};

type MemoryRow = {
  id: string;
  key: string;
  value: string;
  scope: string | null;
  scope_target: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  created_by: string | null;
  last_updated_by: string | null;
};

type MemoryAuditRow = {
  id: number;
  memory_key: string;
  action: 'put' | 'delete' | 'update';
  prev_value: string | null;
  new_value: string | null;
  by_handle: string | null;
  at_ms: number;
};

function normaliseScope(scope: string | null | undefined): MemoryScope {
  if (scope === 'terminal' || scope === 'room') return scope;
  return 'global';
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    scope: normaliseScope(row.scope),
    scopeTarget: row.scope_target,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    createdBy: row.created_by,
    lastUpdatedBy: row.last_updated_by
  };
}

function auditRowToEntry(row: MemoryAuditRow): MemoryAuditEntry {
  return {
    id: row.id,
    memoryKey: row.memory_key,
    action: row.action,
    prevValue: row.prev_value,
    newValue: row.new_value,
    byHandle: row.by_handle,
    atMs: row.at_ms
  };
}

export type PutMemoryInput = {
  key: string;
  value: string;
  scope?: MemoryScope | null;
  scopeTarget?: string | null;
  byHandle?: string | null;
};

export type PutMemoryResult = {
  memory: MemoryRecord;
  created: boolean;
};

/**
 * Upsert a memory row by `key`. If a row with this key already exists,
 * its value/scope/scope_target/last_updated_by are overwritten and an
 * audit row with action='update' is written; otherwise a fresh row is
 * inserted and an audit row with action='put' is written. Returns the
 * stored record + a boolean indicating which path ran.
 */
export function putMemory(input: PutMemoryInput): PutMemoryResult {
  const trimmedKey = input.key.trim();
  if (trimmedKey.length === 0) {
    throw new Error('Memory key cannot be blank.');
  }
  if (typeof input.value !== 'string') {
    throw new Error('Memory value must be a string.');
  }
  const scope = normaliseScope(input.scope ?? null);
  const scopeTarget = input.scopeTarget ?? null;
  const byHandle = input.byHandle ?? null;
  const nowMs = Date.now();

  const db = getIdentityDb();
  const txn = db.transaction((): PutMemoryResult => {
    const existing = db
      .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                       updated_at_ms, created_by, last_updated_by
                FROM memories WHERE key = ?`)
      .get(trimmedKey) as MemoryRow | undefined;

    if (existing) {
      db.prepare(`UPDATE memories
                  SET value = ?, scope = ?, scope_target = ?,
                      last_updated_by = ?, updated_at_ms = ?
                  WHERE key = ?`).run(
        input.value, scope === 'global' ? null : scope, scopeTarget,
        byHandle, nowMs, trimmedKey
      );
      db.prepare(`INSERT INTO memory_audit
                  (memory_key, action, prev_value, new_value, by_handle, at_ms)
                  VALUES (?, 'update', ?, ?, ?, ?)`).run(
        trimmedKey, existing.value, input.value, byHandle, nowMs
      );
      const updated = db
        .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                         updated_at_ms, created_by, last_updated_by
                  FROM memories WHERE key = ?`)
        .get(trimmedKey) as MemoryRow;
      return { memory: rowToRecord(updated), created: false };
    }

    const newId = randomUUID();
    db.prepare(`INSERT INTO memories
                (id, key, value, scope, scope_target, created_at_ms,
                 updated_at_ms, created_by, last_updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      newId, trimmedKey, input.value, scope === 'global' ? null : scope,
      scopeTarget, nowMs, nowMs, byHandle, byHandle
    );
    db.prepare(`INSERT INTO memory_audit
                (memory_key, action, prev_value, new_value, by_handle, at_ms)
                VALUES (?, 'put', NULL, ?, ?, ?)`).run(
      trimmedKey, input.value, byHandle, nowMs
    );
    const inserted = db
      .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                       updated_at_ms, created_by, last_updated_by
                FROM memories WHERE key = ?`)
      .get(trimmedKey) as MemoryRow;
    return { memory: rowToRecord(inserted), created: true };
  });

  return txn();
}

export function getMemory(key: string): MemoryRecord | undefined {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                     updated_at_ms, created_by, last_updated_by
              FROM memories WHERE key = ?`)
    .get(key) as MemoryRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function listMemoriesByPrefix(prefix: string): MemoryRecord[] {
  const db = getIdentityDb();
  if (prefix.length === 0) {
    const rows = db
      .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                       updated_at_ms, created_by, last_updated_by
                FROM memories ORDER BY key ASC`)
      .all() as MemoryRow[];
    return rows.map(rowToRecord);
  }
  // Escape LIKE wildcards (% _) in the supplied prefix so user-supplied
  // characters do not act as patterns. We use a custom escape char.
  const escaped = prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const rows = db
    .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                     updated_at_ms, created_by, last_updated_by
              FROM memories
              WHERE key LIKE ? ESCAPE '\\'
              ORDER BY key ASC`)
    .all(`${escaped}%`) as MemoryRow[];
  return rows.map(rowToRecord);
}

export function listMemoriesForScope(scope: MemoryScope, scopeTarget: string | null): MemoryRecord[] {
  const db = getIdentityDb();
  // Stored 'global' rows have scope = NULL — handle both shapes.
  if (scope === 'global') {
    const rows = db
      .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                       updated_at_ms, created_by, last_updated_by
                FROM memories
                WHERE scope IS NULL OR scope = 'global'
                ORDER BY key ASC`)
      .all() as MemoryRow[];
    return rows.map(rowToRecord);
  }
  if (scopeTarget === null) {
    const rows = db
      .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                       updated_at_ms, created_by, last_updated_by
                FROM memories
                WHERE scope = ? AND scope_target IS NULL
                ORDER BY key ASC`)
      .all(scope) as MemoryRow[];
    return rows.map(rowToRecord);
  }
  const rows = db
    .prepare(`SELECT id, key, value, scope, scope_target, created_at_ms,
                     updated_at_ms, created_by, last_updated_by
              FROM memories
              WHERE scope = ? AND scope_target = ?
              ORDER BY key ASC`)
    .all(scope, scopeTarget) as MemoryRow[];
  return rows.map(rowToRecord);
}

/**
 * Hard-delete a memory row by key. Records a `delete` audit row capturing
 * the value the row had at deletion time so the audit log remains a
 * complete history even after the row is gone.
 *
 * Returns true if a row was actually removed, false otherwise.
 */
export function deleteMemory(key: string, byHandle?: string | null): boolean {
  const db = getIdentityDb();
  const txn = db.transaction((): boolean => {
    const existing = db
      .prepare(`SELECT value FROM memories WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    if (!existing) return false;
    const info = db.prepare(`DELETE FROM memories WHERE key = ?`).run(key);
    if (info.changes === 0) return false;
    db.prepare(`INSERT INTO memory_audit
                (memory_key, action, prev_value, new_value, by_handle, at_ms)
                VALUES (?, 'delete', ?, NULL, ?, ?)`).run(
      key, existing.value, byHandle ?? null, Date.now()
    );
    return true;
  });
  return txn();
}

/**
 * List audit rows newest-first. Filter by key when supplied; cap result
 * with `limit` (default 100, max 1000 — defensive sane bound).
 */
export function listMemoryAudit(key?: string | null, limit?: number | null): MemoryAuditEntry[] {
  const db = getIdentityDb();
  const cappedLimit = Math.max(1, Math.min(typeof limit === 'number' ? limit : 100, 1000));
  if (key && key.length > 0) {
    const rows = db
      .prepare(`SELECT id, memory_key, action, prev_value, new_value, by_handle, at_ms
                FROM memory_audit WHERE memory_key = ?
                ORDER BY at_ms DESC, id DESC LIMIT ?`)
      .all(key, cappedLimit) as MemoryAuditRow[];
    return rows.map(auditRowToEntry);
  }
  const rows = db
    .prepare(`SELECT id, memory_key, action, prev_value, new_value, by_handle, at_ms
              FROM memory_audit
              ORDER BY at_ms DESC, id DESC LIMIT ?`)
    .all(cappedLimit) as MemoryAuditRow[];
  return rows.map(auditRowToEntry);
}

export function resetMemoriesStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM memory_audit`).run();
  db.prepare(`DELETE FROM memories`).run();
}
