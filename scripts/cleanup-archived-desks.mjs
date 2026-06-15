#!/usr/bin/env node
/**
 * cleanANT cleanup — delete ARCHIVED desks, keep the live ones.
 *
 * A "desk" is a `terminal_records` row (the handle-bearing, linked-chat
 * fresh-ANT terminal — NOT the low-level `terminals` process log, which
 * accrues thousands of rows). "Live" = the desk's session is a currently
 * running tmux session (the same signal the terminals page uses to mark a
 * desk `alive`). Everything else is an archived desk.
 *
 * This mirrors the app's own `kill mode='delete'` per desk:
 *   1. soft-delete the linked chat room  (chat_rooms.deleted_at_ms = now)
 *   2. hard-delete the desk              (terminals + terminal_records rows)
 * Chat MESSAGES are preserved (room is only soft-deleted) — they are the
 * transcript asset and stay attributable until/unless a handle is anonymised.
 *
 * The keep-set is computed from LIVE TMUX at run time (authoritative), plus any
 * `--keep <session_id>` you pass. Dry-run prints the full keep/delete split so
 * it can be reviewed before --commit (the operator gate).
 *
 * Usage:
 *   node scripts/cleanup-archived-desks.mjs --dry-run
 *   node scripts/cleanup-archived-desks.mjs --commit [--keep <session_id> ...]
 *
 * Exit codes: 0 ok / 1 bad usage or DB error.
 *
 * Operator note: NOT auto-run. Per JWPK "DO NOT modify the live DB" — the
 * operator's explicit call, inside the backup window.
 */

import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB_PATH = process.env.ANT_FRESH_DB_PATH ?? join(homedir(), '.ant', 'fresh-ant.db');

/**
 * The set of currently-live tmux session names. This is the authoritative
 * "alive" signal — a desk whose session_id is in here is live. Returns an
 * empty set if tmux is not running (no live sessions), never throws.
 */
export function liveTmuxSessions(runner = defaultTmuxRunner) {
  const out = runner();
  return new Set(
    out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function defaultTmuxRunner() {
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8'
    });
  } catch {
    // tmux exits non-zero ("no server running") when nothing is alive.
    return '';
  }
}

/** Every desk (terminal_records row), with the fields the report/delete need. */
export function listDeskRecords(db) {
  return db
    .prepare(
      `SELECT tr.session_id, tr.name, tr.handle, tr.linked_chat_room_id,
              tr.superseded_at_ms,
              cr.archived_at_ms AS room_archived_at_ms,
              cr.deleted_at_ms  AS room_deleted_at_ms
         FROM terminal_records tr
         LEFT JOIN chat_rooms cr ON cr.id = tr.linked_chat_room_id
        ORDER BY tr.name`
    )
    .all();
}

/**
 * Split desks into keep (live tmux OR explicitly kept) and delete (the rest).
 * Pure — takes the records, the live-session set, and an extra-keep set.
 */
export function computeSets(records, liveSet, extraKeep = new Set()) {
  const keep = [];
  const del = [];
  for (const r of records) {
    if (liveSet.has(r.session_id) || extraKeep.has(r.session_id)) keep.push(r);
    else del.push(r);
  }
  return { keep, del };
}

/**
 * The audit_events columns present, or null if the table is absent. The schema
 * has drifted across DB versions (old: actor_handle/created_at_ms; v0.2:
 * audit_id/at_ms/actor_agent_id), so we adapt the insert to whatever exists
 * rather than assume one shape — a mismatch must never abort the cleanup.
 */
export function auditColumns(db) {
  const cols = db.prepare(`PRAGMA table_info(audit_events)`).all().map((c) => c.name);
  return cols.length > 0 ? new Set(cols) : null;
}

function writeAudit(db, cols, { kind, entityId, afterJson }, nowMs) {
  if (!cols) return;
  const fields = [];
  const values = [];
  if (cols.has('audit_id')) {
    fields.push('audit_id');
    values.push(`deskdel-${entityId}-${nowMs}`);
  }
  if (cols.has('at_ms')) {
    fields.push('at_ms');
    values.push(nowMs);
  }
  if (cols.has('created_at_ms')) {
    fields.push('created_at_ms');
    values.push(nowMs);
  }
  fields.push('kind', 'entity_kind', 'entity_id');
  // entity_kind on the v0.2 audit_events is CHECK-constrained to a fixed enum
  // (no 'terminal_record'); 'system' is the housekeeping bucket. The real
  // detail rides in `kind` + after_json.
  values.push(kind, 'system', entityId);
  if (cols.has('actor_handle')) {
    fields.push('actor_handle');
    values.push('@migration');
  }
  if (cols.has('after_json')) {
    fields.push('after_json');
    values.push(afterJson);
  }
  // Best-effort: audit is traceability, never a reason to abort the deletion.
  // A caught failure leaves the txn valid (the statement self-rolls-back).
  try {
    db.prepare(
      `INSERT INTO audit_events (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
    ).run(...values);
  } catch (err) {
    console.warn(`[cleanup-archived-desks] audit write skipped for ${entityId}: ${err.message}`);
  }
}

/**
 * Delete one desk: soft-delete its linked room, then hard-delete the desk
 * (terminals + terminal_records, matching deleteTerminalById). Logs an audit
 * row adapted to the live schema. Caller wraps the batch in a transaction.
 */
function deleteOneDesk(db, desk, nowMs, cols) {
  if (desk.linked_chat_room_id) {
    db.prepare(
      `UPDATE chat_rooms SET deleted_at_ms = ? WHERE id = ? AND deleted_at_ms IS NULL`
    ).run(nowMs, desk.linked_chat_room_id);
  }
  db.prepare(`DELETE FROM terminals WHERE id = ?`).run(desk.session_id);
  db.prepare(`DELETE FROM terminal_records WHERE session_id = ?`).run(desk.session_id);
  writeAudit(
    db,
    cols,
    {
      kind: 'terminal_record.desk_deleted',
      entityId: desk.session_id,
      afterJson: JSON.stringify({
        reason: 'cleanANT archived-desk cleanup',
        name: desk.name,
        handle: desk.handle,
        linked_chat_room_id: desk.linked_chat_room_id
      })
    },
    nowMs
  );
}

/** Apply deletion across the delete-set in one transaction. Returns count. */
export function applyDeskDeletion(db, deleteSet, nowMs = Date.now()) {
  if (deleteSet.length === 0) return 0;
  const cols = auditColumns(db);
  const tx = db.transaction((items) => {
    for (const d of items) deleteOneDesk(db, d, nowMs, cols);
  });
  tx(deleteSet);
  return deleteSet.length;
}

function parseArgs(argv) {
  const args = { mode: null, keep: new Set() };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--commit') args.mode = a;
    else if (a === '--keep' && i + 1 < argv.length) args.keep.add(argv[++i]);
  }
  return args;
}

function main() {
  const { mode, keep } = parseArgs(process.argv);
  if (mode !== '--dry-run' && mode !== '--commit') {
    console.error('Usage: node scripts/cleanup-archived-desks.mjs --dry-run | --commit [--keep <session_id> ...]');
    process.exit(1);
  }
  const commit = mode === '--commit';
  console.log(`DB: ${DB_PATH}`);
  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  const db = new Database(DB_PATH);
  const liveSet = liveTmuxSessions();
  console.log(`Live tmux sessions: ${liveSet.size} [${[...liveSet].join(', ')}]`);

  const records = listDeskRecords(db);
  const { keep: keepSet, del: deleteSet } = computeSets(records, liveSet, keep);

  console.log(`\nDesks total: ${records.length}  |  keep: ${keepSet.length}  |  delete: ${deleteSet.length}`);
  console.log(`\nKEEP (live or --keep):`);
  for (const r of keepSet) console.log(`  ✓ ${r.name}  ${r.handle ?? '(no handle)'}  session=${r.session_id}`);
  console.log(`\nDELETE (archived):`);
  for (const r of deleteSet) {
    const room = r.linked_chat_room_id ? `room=${r.linked_chat_room_id}` : 'no-room';
    console.log(`  ✗ ${r.name}  ${r.handle ?? '(no handle)'}  session=${r.session_id}  ${room}`);
  }

  if (!commit) {
    console.log(`\nDry-run — re-run with --commit to soft-delete the linked rooms and hard-delete the ${deleteSet.length} archived desks above.`);
    db.close();
    return;
  }
  const n = applyDeskDeletion(db, deleteSet);
  console.log(`\nCommitted: ${n} desks deleted (linked rooms soft-deleted, desk rows removed).`);
  db.close();
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
