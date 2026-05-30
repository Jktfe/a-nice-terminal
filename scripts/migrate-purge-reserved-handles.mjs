#!/usr/bin/env node
/**
 * One-shot migration — purge reserved handles from existing
 * `terminal_records` rows.
 *
 * Sec-iter2 Fix #4 of the 2026-05-30 enterprise security pass.
 *
 * Background: sec-iter1 added handle uniqueness + reserved-list
 * enforcement at register-time, BUT only validated NEW handle writes.
 * Existing rows whose handle is in `data/reserved-handles.json` (most
 * critically `@admin` — the bypass surface in the iter2 review) stayed
 * untouched. Sec-iter2 closes the writer paths (Fix #1 + #2) and the
 * approver gate (Fix #3), but operators MUST also flush any pre-existing
 * reserved-handle rows so the now-validated read paths don't surface
 * stale spoof rows.
 *
 * Strategy: read `data/reserved-handles.json`, find every
 * `terminal_records` row whose `handle` is in that list
 * (case-insensitive), NULL the handle on those rows, and log a row to
 * `audit_events` so the operation is forensically traceable.
 *
 * We do NOT delete the row — its `session_id` is still referenced by
 * chat_rooms / room_memberships / audit history and a cascading delete
 * would corrupt those readers. Setting handle=NULL makes the row
 * invisible to handle-based lookups; the row continues to exist for
 * historical attribution.
 *
 * Usage:
 *   node scripts/migrate-purge-reserved-handles.mjs --dry-run
 *   node scripts/migrate-purge-reserved-handles.mjs --commit
 *
 * Exit codes:
 *   0  — no reserved-handle rows OR migration succeeded
 *   1  — bad usage / DB error
 *
 * Operator note: this script EXISTS but is NOT auto-run by the
 * substrate bounce. Per JWPK rule ("DO NOT modify the live DB") the
 * operator's call.
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DB_PATH = process.env.ANT_FRESH_DB_PATH ?? join(homedir(), '.ant', 'fresh-ant.db');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the reserved-handle list from `data/reserved-handles.json` at
 * the repo root. Mirrors the resolution logic in `handleValidation.ts`
 * but accepts an explicit override path for testability. Returns the
 * RAW list (preserves case) — callers do case-insensitive comparison.
 */
export function loadReservedHandles(overridePath = null) {
  const candidates = overridePath ? [overridePath] : [
    join(process.cwd(), 'data', 'reserved-handles.json'),
    join(__dirname, '..', 'data', 'reserved-handles.json'),
    resolve(__dirname, '../data/reserved-handles.json')
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, 'utf8'));
        if (!Array.isArray(parsed)) throw new Error(`${p}: not an array`);
        return parsed.filter((h) => typeof h === 'string');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[migrate-purge-reserved] failed to read ${p}:`, err);
      }
    }
  }
  throw new Error(
    `Could not locate data/reserved-handles.json. Set --reserved-path <path> or run from repo root.`
  );
}

/**
 * Find every terminal_records row whose handle (case-insensitive)
 * appears in the reserved list. Returns rows newest-first so the
 * audit output groups the most-recent (most-likely-active) offenders
 * first.
 */
export function findReservedHandleRows(db, reservedList) {
  if (reservedList.length === 0) return [];
  // SQLite NOCASE collation gives us case-insensitive IN comparison
  // without writing the LOWER() expression on every row.
  const placeholders = reservedList.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT session_id, name, handle, created_at_ms, superseded_at_ms
       FROM terminal_records
      WHERE handle IS NOT NULL
        AND handle != ''
        AND handle COLLATE NOCASE IN (${placeholders})
      ORDER BY created_at_ms DESC, session_id ASC`
  ).all(...reservedList);
  return rows;
}

/**
 * NULL the handle on a single row + log to audit_events. Called inside
 * a transaction so partial purges never leave the audit log out of
 * sync with the row state.
 *
 * Audit shape mirrors the sec-iter1 v02 bridge log: `kind`
 * 'terminal_record.handle_purged_reserved', `entity_kind`
 * 'terminal_record', `entity_id` session_id, `after_json` carries the
 * prior handle + reason. We deliberately do NOT write a `before_json`
 * — the prior handle IS the only mutated field and we already capture
 * it in `after_json.prior_handle`.
 */
function purgeOne(db, row, nowMs, auditEventsTableExists) {
  db.prepare(
    `UPDATE terminal_records SET handle = NULL, updated_at_ms = ? WHERE session_id = ?`
  ).run(nowMs, row.session_id);
  if (auditEventsTableExists) {
    const auditRow = {
      kind: 'terminal_record.handle_purged_reserved',
      entity_kind: 'terminal_record',
      entity_id: row.session_id,
      actor_handle: '@migration',
      created_at_ms: nowMs,
      after_json: JSON.stringify({
        prior_handle: row.handle,
        reason: 'sec-iter2 fix #4: reserved-handle purge',
        was_superseded: row.superseded_at_ms !== null
      })
    };
    db.prepare(
      `INSERT INTO audit_events (kind, entity_kind, entity_id, actor_handle, created_at_ms, after_json)
       VALUES (@kind, @entity_kind, @entity_id, @actor_handle, @created_at_ms, @after_json)`
    ).run(auditRow);
  }
}

/**
 * Apply the purge across all reserved-handle rows in a single
 * transaction. Returns the number of rows updated. Safe to call when
 * `rows` is empty.
 *
 * `auditEventsTableExists` controls whether we emit audit rows. The
 * caller introspects sqlite_master to decide — the audit_events table
 * is part of the v0.2 substrate and may not exist on very old DBs.
 */
export function applyPurge(db, rows, auditEventsTableExists, nowMs = Date.now()) {
  if (rows.length === 0) return 0;
  const tx = db.transaction((items) => {
    for (const r of items) purgeOne(db, r, nowMs, auditEventsTableExists);
  });
  tx(rows);
  return rows.length;
}

/**
 * Introspect sqlite_master to check whether the audit_events table
 * exists. Used to skip audit writes gracefully on older DBs.
 */
export function auditEventsTableExists(db) {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'`
  ).get();
  return Boolean(row);
}

function parseArgs(argv) {
  const args = { mode: null, reservedPath: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--commit') {
      args.mode = a;
    } else if (a === '--reserved-path' && i + 1 < argv.length) {
      args.reservedPath = argv[++i];
    }
  }
  return args;
}

function main() {
  const { mode, reservedPath } = parseArgs(process.argv);
  if (mode !== '--dry-run' && mode !== '--commit') {
    console.error(
      'Usage: node scripts/migrate-purge-reserved-handles.mjs --dry-run | --commit [--reserved-path <path>]'
    );
    process.exit(1);
  }
  const commit = mode === '--commit';

  console.log(`DB: ${DB_PATH}`);
  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  let reservedList;
  try {
    reservedList = loadReservedHandles(reservedPath);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`Reserved handles loaded: ${reservedList.length}`);

  const db = new Database(DB_PATH);
  const rows = findReservedHandleRows(db, reservedList);
  const hasAudit = auditEventsTableExists(db);

  console.log(`\nFound ${rows.length} terminal_records rows with reserved handles.`);
  console.log(`audit_events table: ${hasAudit ? 'present' : 'missing (audit writes skipped)'}`);

  if (rows.length === 0) {
    console.log('Nothing to purge.');
    db.close();
    return;
  }

  for (const r of rows) {
    const supersededTag = r.superseded_at_ms !== null ? ' [superseded]' : '';
    console.log(`  ${r.handle}  session=${r.session_id}  name="${r.name}"  created_at_ms=${r.created_at_ms}${supersededTag}`);
  }

  if (!commit) {
    console.log(`\nDry-run — re-run with --commit to NULL the handle column on the above rows.`);
    db.close();
    return;
  }

  const updated = applyPurge(db, rows, hasAudit);
  console.log(`\nCommitted: ${updated} rows updated.`);
  if (hasAudit) {
    console.log(`Audit: ${updated} rows logged to audit_events as kind='terminal_record.handle_purged_reserved'.`);
  }
  db.close();
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
