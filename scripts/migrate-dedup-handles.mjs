#!/usr/bin/env node
/**
 * One-shot migration — deduplicate `terminal_records.handle` values
 * BEFORE the UNIQUE INDEX `terminal_records_handle_unique` is created
 * by the schema migration (db.ts).
 *
 * Fix #2 of sec-iter1 (2026-05-30 enterprise security pass).
 *
 * Background: pre-fix the column had no UNIQUE constraint so the
 * @you-spam era + register-time bugs left some handles claimed by 2+
 * rows simultaneously. The DB schema migration adds the partial UNIQUE
 * index next — without this dedup it will throw SQLITE_CONSTRAINT and
 * server boot aborts.
 *
 * Strategy: for any handle with multiple ACTIVE (non-superseded) rows,
 * KEEP the most-recently-created row and NULL the handle on older
 * duplicates. We do NOT delete the row — its session_id is still
 * referenced by chat_rooms / room_memberships / audit history and a
 * cascading delete would corrupt those readers. Setting handle=NULL
 * just makes the row invisible to handle-based lookups (which fall
 * back to deriveHandle anyway).
 *
 * Audit trail: every modified row is logged to stdout with its prior
 * handle, session_id, name, created_at_ms so operators can verify the
 * pick was correct + reverse it via SQL if needed.
 *
 * Usage:
 *   node scripts/migrate-dedup-handles.mjs --dry-run
 *   node scripts/migrate-dedup-handles.mjs --commit
 *
 * Exit code:
 *   0  — no duplicates OR migration succeeded
 *   1  — bad usage / DB error
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = process.env.ANT_FRESH_DB_PATH ?? join(homedir(), '.ant', 'fresh-ant.db');

/**
 * Find handles that have more than one ACTIVE (non-superseded) row.
 * Returns rows in descending duplicate-count order.
 */
export function findDuplicateHandles(db) {
  return db.prepare(`
    SELECT handle, COUNT(*) AS cnt
      FROM terminal_records
     WHERE handle IS NOT NULL AND handle != ''
       AND superseded_at_ms IS NULL
     GROUP BY handle
    HAVING cnt > 1
     ORDER BY cnt DESC, handle ASC
  `).all();
}

/**
 * For a single duplicate handle, return the rows newest-first. The
 * caller keeps the first one and NULLifies the rest.
 */
export function rowsForDuplicateHandle(db, handle) {
  return db.prepare(`
    SELECT session_id, name, handle, created_at_ms
      FROM terminal_records
     WHERE handle = ?
       AND superseded_at_ms IS NULL
     ORDER BY created_at_ms DESC, session_id DESC
  `).all(handle);
}

/**
 * Plan the rows to nullify across ALL duplicate handles. Returns an
 * array of { session_id, name, handle, created_at_ms } in the order
 * they will be updated.
 */
export function planDedup(db) {
  const dupes = findDuplicateHandles(db);
  const toNullify = [];
  for (const { handle } of dupes) {
    const rows = rowsForDuplicateHandle(db, handle);
    for (const r of rows.slice(1)) toNullify.push(r);
  }
  return { duplicateHandleCount: dupes.length, toNullify };
}

/**
 * Apply the dedup in a single transaction. Returns the number of rows
 * updated. Safe to call even when toNullify is empty.
 */
export function applyDedup(db, toNullify, nowMs = Date.now()) {
  if (toNullify.length === 0) return 0;
  const update = db.prepare(
    `UPDATE terminal_records SET handle = NULL, updated_at_ms = ? WHERE session_id = ?`
  );
  const tx = db.transaction((items) => {
    for (const r of items) update.run(nowMs, r.session_id);
  });
  tx(toNullify);
  return toNullify.length;
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--dry-run' && mode !== '--commit') {
    console.error('Usage: node scripts/migrate-dedup-handles.mjs --dry-run | --commit');
    process.exit(1);
  }
  const commit = mode === '--commit';

  console.log(`DB: ${DB_PATH}`);
  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  const db = new Database(DB_PATH);

  const dupes = findDuplicateHandles(db);
  console.log(`\nFound ${dupes.length} duplicate handles across active rows.`);

  if (dupes.length === 0) {
    console.log('Nothing to do — the UNIQUE INDEX can be created safely.');
    db.close();
    return;
  }

  const { toNullify } = planDedup(db);
  for (const { handle, cnt } of dupes) {
    const rows = rowsForDuplicateHandle(db, handle);
    console.log(`\nHandle ${handle} — ${cnt} active rows:`);
    console.log(`  KEEP    ${rows[0].session_id} (name=${rows[0].name}, created_at_ms=${rows[0].created_at_ms})`);
    for (const r of rows.slice(1)) {
      console.log(`  NULLIFY ${r.session_id} (name=${r.name}, created_at_ms=${r.created_at_ms})`);
    }
  }

  console.log(`\nSummary: ${toNullify.length} rows will have handle=NULL set.`);

  if (!commit) {
    console.log('\nDry-run — re-run with --commit to apply.');
    db.close();
    return;
  }

  const updated = applyDedup(db, toNullify);
  console.log(`\nCommitted: ${updated} rows updated. The UNIQUE INDEX is now safe to create.`);
  db.close();
}

// Only run when invoked directly (not when imported by tests). Compare
// against argv[1] resolved to a file:// URL so the check works under
// both `node scripts/migrate-dedup-handles.mjs` and any harness that
// imports the module without setting argv[1].
import { pathToFileURL } from 'node:url';
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
