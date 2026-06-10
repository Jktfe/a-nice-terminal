/**
 * trackerStore — collaborative audit tables for ANT chatrooms.
 *
 * JWPK msg_p28s81vbyz: "a tracker element ... a table where we keep an audit
 * of changes ... that we can all add to, update and view". The fourth inline
 * widget on the fence-render rail (after poll + status board), but unlike
 * those it is a full typed table: N tables per room, each with a column
 * schema, rows added over time, cells edited in place, and — the load-bearing
 * requirement — an APPEND-ONLY change log so nothing is ever silently
 * overwritten (financial-payments use case: GVPL4).
 *
 * Three tables:
 *   room_tracker_tables  — one row per tracker (id, room, title, columns JSON)
 *   room_tracker_rows    — one row per data row (cells JSON keyed by col key)
 *   room_tracker_events  — append-only audit: every cell write (old→new, who, when)
 *
 * Pure SQLite + invariants; no model work. Cell values are stored as strings
 * (the column `type` drives RENDER, not storage — keeps the schema simple and
 * lets a mistyped value still round-trip rather than being rejected/lost).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type TrackerColumnType = 'text' | 'number' | 'currency' | 'date' | 'bool' | 'link';

export type TrackerColumn = {
  /** Stable key used in cells + events (slug of the label). */
  key: string;
  label: string;
  type: TrackerColumnType;
};

export type TrackerTable = {
  id: string;
  roomId: string;
  title: string;
  columns: TrackerColumn[];
  createdByHandle: string;
  createdAtMs: number;
};

export type TrackerRow = {
  id: string;
  tableId: string;
  /** col key → cell value (string; '' = empty). */
  cells: Record<string, string>;
  createdByHandle: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type TrackerEvent = {
  seq: number;
  tableId: string;
  rowId: string;
  /** 'row.add' | 'cell.set' */
  kind: 'row.add' | 'cell.set';
  columnKey: string | null;
  oldValue: string | null;
  newValue: string | null;
  byHandle: string;
  atMs: number;
};

export type TrackerView = TrackerTable & {
  rows: TrackerRow[];
  events: TrackerEvent[];
};

let schemaReadyForDb: unknown = null;
function ensureSchema(db = getIdentityDb()): void {
  if (schemaReadyForDb === db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_tracker_tables (
      id                TEXT PRIMARY KEY,
      room_id           TEXT NOT NULL,
      title             TEXT NOT NULL,
      columns_json      TEXT NOT NULL DEFAULT '[]',
      created_by_handle TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracker_tables_room ON room_tracker_tables (room_id, created_at_ms);

    CREATE TABLE IF NOT EXISTS room_tracker_rows (
      id                TEXT PRIMARY KEY,
      table_id          TEXT NOT NULL,
      cells_json        TEXT NOT NULL DEFAULT '{}',
      created_by_handle TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL,
      updated_at_ms     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracker_rows_table ON room_tracker_rows (table_id, created_at_ms);

    CREATE TABLE IF NOT EXISTS room_tracker_events (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id    TEXT NOT NULL,
      row_id      TEXT NOT NULL,
      kind        TEXT NOT NULL,
      column_key  TEXT,
      old_value   TEXT,
      new_value   TEXT,
      by_handle   TEXT NOT NULL,
      at_ms       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracker_events_table ON room_tracker_events (table_id, seq);
  `);
  schemaReadyForDb = db;
}

/** Slug a column label into a stable key (a-z0-9 + dashes), deduped by caller. */
export function columnKeyForLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'col';
}

function normaliseColumns(columns: Array<{ label: string; type?: TrackerColumnType }>): TrackerColumn[] {
  const out: TrackerColumn[] = [];
  const seen = new Set<string>();
  for (const col of columns) {
    const label = col.label.trim();
    if (label.length === 0) continue;
    let key = columnKeyForLabel(label);
    let n = 2;
    while (seen.has(key)) key = `${columnKeyForLabel(label)}-${n++}`;
    seen.add(key);
    out.push({ key, label, type: col.type ?? 'text' });
  }
  return out;
}

export type CreateTrackerInput = {
  roomId: string;
  title: string;
  columns: Array<{ label: string; type?: TrackerColumnType }>;
  createdByHandle: string;
};

export function createTracker(input: CreateTrackerInput, now = Date.now(), db = getIdentityDb()): TrackerTable {
  ensureSchema(db);
  const id = `trk_${randomUUID().slice(0, 12)}`;
  const columns = normaliseColumns(input.columns);
  db.prepare(
    `INSERT INTO room_tracker_tables (id, room_id, title, columns_json, created_by_handle, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.roomId, input.title.trim(), JSON.stringify(columns), input.createdByHandle, now);
  return { id, roomId: input.roomId, title: input.title.trim(), columns, createdByHandle: input.createdByHandle, createdAtMs: now };
}

export function getTracker(tableId: string, db = getIdentityDb()): TrackerTable | null {
  ensureSchema(db);
  const row = db
    .prepare(`SELECT * FROM room_tracker_tables WHERE id = ?`)
    .get(tableId) as Record<string, unknown> | undefined;
  return row ? rowToTable(row) : null;
}

export type AddRowInput = {
  tableId: string;
  cells: Record<string, string>;
  byHandle: string;
};

export function addRow(input: AddRowInput, now = Date.now(), db = getIdentityDb()): TrackerRow | null {
  ensureSchema(db);
  const table = getTracker(input.tableId, db);
  if (!table) return null;
  const id = `row_${randomUUID().slice(0, 12)}`;
  // Keep only known columns; coerce to string.
  const cells: Record<string, string> = {};
  for (const col of table.columns) {
    const raw = input.cells[col.key];
    cells[col.key] = raw === undefined || raw === null ? '' : String(raw);
  }
  db.prepare(
    `INSERT INTO room_tracker_rows (id, table_id, cells_json, created_by_handle, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.tableId, JSON.stringify(cells), input.byHandle, now, now);
  db.prepare(
    `INSERT INTO room_tracker_events (table_id, row_id, kind, column_key, old_value, new_value, by_handle, at_ms)
     VALUES (?, ?, 'row.add', NULL, NULL, ?, ?, ?)`
  ).run(input.tableId, id, JSON.stringify(cells), input.byHandle, now);
  return { id, tableId: input.tableId, cells, createdByHandle: input.byHandle, createdAtMs: now, updatedAtMs: now };
}

export type SetCellInput = {
  tableId: string;
  rowId: string;
  columnKey: string;
  value: string;
  byHandle: string;
};

/** Update one cell, appending a cell.set audit event with the old→new value. No-op (returns row) if unchanged. */
export function setCell(input: SetCellInput, now = Date.now(), db = getIdentityDb()): TrackerRow | null {
  ensureSchema(db);
  const table = getTracker(input.tableId, db);
  if (!table) return null;
  if (!table.columns.some((c) => c.key === input.columnKey)) return null;
  const rowRec = db
    .prepare(`SELECT * FROM room_tracker_rows WHERE id = ? AND table_id = ?`)
    .get(input.rowId, input.tableId) as Record<string, unknown> | undefined;
  if (!rowRec) return null;
  const row = rowToRow(rowRec);
  const oldValue = row.cells[input.columnKey] ?? '';
  const newValue = String(input.value ?? '');
  if (oldValue === newValue) return row;
  row.cells[input.columnKey] = newValue;
  db.prepare(`UPDATE room_tracker_rows SET cells_json = ?, updated_at_ms = ? WHERE id = ?`).run(
    JSON.stringify(row.cells),
    now,
    input.rowId
  );
  db.prepare(
    `INSERT INTO room_tracker_events (table_id, row_id, kind, column_key, old_value, new_value, by_handle, at_ms)
     VALUES (?, ?, 'cell.set', ?, ?, ?, ?, ?)`
  ).run(input.tableId, input.rowId, input.columnKey, oldValue, newValue, input.byHandle, now);
  row.updatedAtMs = now;
  return row;
}

export function getTrackerView(tableId: string, db = getIdentityDb()): TrackerView | null {
  ensureSchema(db);
  const table = getTracker(tableId, db);
  if (!table) return null;
  const rows = (db
    .prepare(`SELECT * FROM room_tracker_rows WHERE table_id = ? ORDER BY created_at_ms ASC, id ASC`)
    .all(tableId) as Record<string, unknown>[]).map(rowToRow);
  const events = (db
    .prepare(`SELECT * FROM room_tracker_events WHERE table_id = ? ORDER BY seq ASC`)
    .all(tableId) as Record<string, unknown>[]).map(rowToEvent);
  return { ...table, rows, events };
}

export function listTrackersForRoom(roomId: string, db = getIdentityDb()): TrackerTable[] {
  ensureSchema(db);
  return (db
    .prepare(`SELECT * FROM room_tracker_tables WHERE room_id = ? ORDER BY created_at_ms DESC`)
    .all(roomId) as Record<string, unknown>[]).map(rowToTable);
}

function rowToTable(row: Record<string, unknown>): TrackerTable {
  let columns: TrackerColumn[] = [];
  try {
    const parsed = JSON.parse(String(row.columns_json));
    if (Array.isArray(parsed)) columns = parsed;
  } catch {
    columns = [];
  }
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    title: String(row.title),
    columns,
    createdByHandle: String(row.created_by_handle),
    createdAtMs: Number(row.created_at_ms)
  };
}

function rowToRow(row: Record<string, unknown>): TrackerRow {
  let cells: Record<string, string> = {};
  try {
    const parsed = JSON.parse(String(row.cells_json));
    if (parsed && typeof parsed === 'object') cells = parsed as Record<string, string>;
  } catch {
    cells = {};
  }
  return {
    id: String(row.id),
    tableId: String(row.table_id),
    cells,
    createdByHandle: String(row.created_by_handle),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms)
  };
}

function rowToEvent(row: Record<string, unknown>): TrackerEvent {
  return {
    seq: Number(row.seq),
    tableId: String(row.table_id),
    rowId: String(row.row_id),
    kind: row.kind === 'cell.set' ? 'cell.set' : 'row.add',
    columnKey: row.column_key === null ? null : String(row.column_key),
    oldValue: row.old_value === null ? null : String(row.old_value),
    newValue: row.new_value === null ? null : String(row.new_value),
    byHandle: String(row.by_handle),
    atMs: Number(row.at_ms)
  };
}

export function resetTrackerStoreForTests(db = getIdentityDb()): void {
  ensureSchema(db);
  db.exec(`DELETE FROM room_tracker_events; DELETE FROM room_tracker_rows; DELETE FROM room_tracker_tables;`);
}
