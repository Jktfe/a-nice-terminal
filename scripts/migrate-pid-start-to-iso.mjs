#!/usr/bin/env node
/**
 * One-shot migration — normalise existing locale-formatted pid_start
 * values in `terminals` to ISO 8601.
 *
 * Background: PR-A (commit 9fea23d / PR #94) shipped pidStartNormaliser
 * which converts pid_start on every write site. Existing rows that pre-
 * date PR-A still carry locale-formatted strings ("Fri 29 May 20:51:24
 * 2026") and the new binary's read-side normalises its lookup value to
 * ISO, so the SQL comparison misses and the agent appears unbound.
 *
 * Usage:
 *   node scripts/migrate-pid-start-to-iso.mjs --dry-run
 *   node scripts/migrate-pid-start-to-iso.mjs --commit
 *
 * Prints a summary either way: total rows, rows requiring migration,
 * any rows whose pid_start cannot be parsed (left untouched).
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = process.env.ANT_FRESH_DB_PATH ?? join(homedir(), '.ant', 'fresh-ant.db');

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

function normaliseToIso(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (ISO_PREFIX.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--dry-run' && mode !== '--commit') {
    console.error('Usage: node scripts/migrate-pid-start-to-iso.mjs --dry-run | --commit');
    process.exit(1);
  }
  const commit = mode === '--commit';

  console.log(`DB: ${DB_PATH}`);
  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  const db = new Database(DB_PATH);

  const rows = db.prepare(`SELECT id, name, pid, pid_start FROM terminals`).all();
  console.log(`Inspecting ${rows.length} terminals rows.`);

  let alreadyIso = 0;
  let toMigrate = 0;
  let unparseable = 0;
  const migrations = [];

  for (const row of rows) {
    if (row.pid_start === null) continue;
    if (typeof row.pid_start !== 'string') continue;
    const trimmed = row.pid_start.trim();
    if (trimmed.length === 0) continue;
    if (ISO_PREFIX.test(trimmed)) {
      alreadyIso += 1;
      continue;
    }
    const iso = normaliseToIso(trimmed);
    if (iso === null) {
      unparseable += 1;
      console.log(`  UNPARSEABLE: ${row.id} (${row.name}) — pid_start=${JSON.stringify(trimmed)}`);
      continue;
    }
    toMigrate += 1;
    migrations.push({ id: row.id, name: row.name, oldValue: trimmed, newValue: iso });
  }

  console.log(`\nSummary:`);
  console.log(`  Already ISO:     ${alreadyIso}`);
  console.log(`  To migrate:      ${toMigrate}`);
  console.log(`  Unparseable:     ${unparseable}`);

  if (toMigrate === 0) {
    console.log('\nNothing to do.');
    db.close();
    return;
  }

  if (!commit) {
    console.log('\nDry-run — would migrate these rows:');
    for (const m of migrations.slice(0, 10)) {
      console.log(`  ${m.id} (${m.name})`);
      console.log(`    ${JSON.stringify(m.oldValue)}`);
      console.log(`    -> ${JSON.stringify(m.newValue)}`);
    }
    if (migrations.length > 10) {
      console.log(`  ... and ${migrations.length - 10} more`);
    }
    console.log(`\nRe-run with --commit to apply.`);
    db.close();
    return;
  }

  // Apply migrations in a single transaction so a failure rolls back.
  const update = db.prepare(`UPDATE terminals SET pid_start = ? WHERE id = ?`);
  const tx = db.transaction((items) => {
    for (const m of items) update.run(m.newValue, m.id);
  });
  tx(migrations);
  console.log(`\nCommitted: ${migrations.length} rows updated.`);
  db.close();
}

main();
