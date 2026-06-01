/**
 * roomRespondersStore — per-room ordered responder list per the responders
 * design contract 2026-05-13 (M3.b.5).
 *
 * Schema (see ./db.ts):
 *   chat_room_responders(id PK, room_id, terminal_id, order_index, set_by,
 *                        set_at)
 *   UNIQUE(room_id, terminal_id) — a terminal can be a responder once per room
 *   UNIQUE(room_id, order_index) — sparse integer ordering; gap-tolerant
 *
 * Ordering algorithm (B2 lock in the contract):
 *   - append:  max(order_index for room ?? 0) + 1000
 *   - insertAt(N): floor((before + after) / 2); if after - before < 2,
 *                  compact-tx then retry
 *   - move(to N): same midpoint algorithm in a tx
 *   - remove: pure DELETE, no reflow of remaining rows
 *   - PUT replace-all: clear then insert with 1000, 2000, 3000, ...
 *   - compact: renumber all rows in a room to 1000, 2000, 3000, ... in tx
 *
 * Reads always order by order_index ASC so logical positions are the sorted
 * order regardless of integer gaps. Tests pin both the sparse-roundtrip and
 * the compact-on-collision path.
 */
import { getIdentityDb } from './db';

export type ResponderRow = {
  id: number;
  room_id: string;
  terminal_id: string;
  order_index: number;
  set_by: string | null;
  set_at: number;
};

export type SetRespondersInput = {
  roomId: string;
  terminalIds: string[];
  set_by: string | null;
};

export type AddResponderInput = {
  roomId: string;
  terminalId: string;
  at?: number;
  set_by: string | null;
};

export type MoveResponderInput = {
  roomId: string;
  terminalId: string;
  to: number;
  set_by: string | null;
};

const STEP = 1000;
const MIN_GAP_BEFORE_COMPACT = 2;

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function listRowsRaw(roomId: string): ResponderRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT id, room_id, terminal_id, order_index, set_by, set_at
              FROM chat_room_responders WHERE room_id = ?
              ORDER BY order_index ASC`)
    .all(roomId) as ResponderRow[];
}

export function listRespondersForRoom(roomId: string): ResponderRow[] {
  return listRowsRaw(roomId);
}

export function setResponders(input: SetRespondersInput): ResponderRow[] {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const writeTx = db.transaction(() => {
    db.prepare(`DELETE FROM chat_room_responders WHERE room_id = ?`).run(input.roomId);
    const insertStmt = db.prepare(`INSERT INTO chat_room_responders
      (room_id, terminal_id, order_index, set_by, set_at)
      VALUES (?, ?, ?, ?, ?)`);
    for (let position = 0; position < input.terminalIds.length; position += 1) {
      insertStmt.run(input.roomId, input.terminalIds[position], (position + 1) * STEP, input.set_by, now);
    }
  });
  writeTx();
  return listRowsRaw(input.roomId);
}

export function addResponder(input: AddResponderInput): ResponderRow {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const insertTx = db.transaction(() => {
    const rows = listRowsRaw(input.roomId);
    if (input.at === undefined || input.at >= rows.length) {
      const nextOrder = (rows.length === 0 ? 0 : rows[rows.length - 1].order_index) + STEP;
      runInsert(db, input.roomId, input.terminalId, nextOrder, input.set_by, now);
      return;
    }
    const targetPosition = Math.max(0, Math.floor(input.at));
    const beforeOrder = targetPosition === 0 ? 0 : rows[targetPosition - 1].order_index;
    const afterOrder = rows[targetPosition].order_index;
    if (afterOrder - beforeOrder < MIN_GAP_BEFORE_COMPACT) {
      compactInternal(db, input.roomId);
      const refreshed = listRowsRaw(input.roomId);
      const before2 = targetPosition === 0 ? 0 : refreshed[targetPosition - 1].order_index;
      const after2 = refreshed[targetPosition].order_index;
      runInsert(db, input.roomId, input.terminalId, Math.floor((before2 + after2) / 2), input.set_by, now);
      return;
    }
    runInsert(db, input.roomId, input.terminalId, Math.floor((beforeOrder + afterOrder) / 2), input.set_by, now);
  });
  insertTx();
  const out = listRowsRaw(input.roomId).find((row) => row.terminal_id === input.terminalId);
  if (!out) throw new Error('addResponder insert did not land — unique constraint child-2tion?');
  return out;
}

export function removeResponder(roomId: string, terminalId: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(`DELETE FROM chat_room_responders
    WHERE room_id = ? AND terminal_id = ?`).run(roomId, terminalId);
  return info.changes > 0;
}

export function moveResponder(input: MoveResponderInput): ResponderRow {
  const db = getIdentityDb();
  const moveTx = db.transaction(() => {
    const rows = listRowsRaw(input.roomId).filter((row) => row.terminal_id !== input.terminalId);
    const targetPosition = Math.max(0, Math.min(Math.floor(input.to), rows.length));
    const beforeOrder = targetPosition === 0 ? 0 : rows[targetPosition - 1].order_index;
    const afterOrder = targetPosition === rows.length ? beforeOrder + 2 * STEP : rows[targetPosition].order_index;
    const newOrder = afterOrder - beforeOrder < MIN_GAP_BEFORE_COMPACT
      ? (compactInternal(db, input.roomId), pickAfterCompact(db, input.roomId, input.terminalId, targetPosition))
      : Math.floor((beforeOrder + afterOrder) / 2);
    db.prepare(`UPDATE chat_room_responders
      SET order_index = ?, set_at = ? WHERE room_id = ? AND terminal_id = ?`)
      .run(newOrder, currentUnixSeconds(), input.roomId, input.terminalId);
  });
  moveTx();
  const out = listRowsRaw(input.roomId).find((row) => row.terminal_id === input.terminalId);
  if (!out) throw new Error(`moveResponder: terminal ${input.terminalId} not in room ${input.roomId}`);
  return out;
}

export function compactRoom(roomId: string): ResponderRow[] {
  const db = getIdentityDb();
  const tx = db.transaction(() => compactInternal(db, roomId));
  tx();
  return listRowsRaw(roomId);
}

function pickAfterCompact(db: ReturnType<typeof getIdentityDb>, roomId: string, excludeTerminalId: string, position: number): number {
  const rows = listRowsRaw(roomId).filter((row) => row.terminal_id !== excludeTerminalId);
  const beforeOrder = position === 0 ? 0 : rows[position - 1].order_index;
  const afterOrder = position === rows.length ? beforeOrder + 2 * STEP : rows[position].order_index;
  return Math.floor((beforeOrder + afterOrder) / 2);
}

function runInsert(db: ReturnType<typeof getIdentityDb>, roomId: string, terminalId: string, orderIndex: number, setBy: string | null, now: number): void {
  db.prepare(`INSERT INTO chat_room_responders
    (room_id, terminal_id, order_index, set_by, set_at)
    VALUES (?, ?, ?, ?, ?)`).run(roomId, terminalId, orderIndex, setBy, now);
}

function compactInternal(db: ReturnType<typeof getIdentityDb>, roomId: string): void {
  const rows = listRowsRaw(roomId);
  const swapStmt = db.prepare(`UPDATE chat_room_responders SET order_index = ? WHERE id = ?`);
  for (let position = 0; position < rows.length; position += 1) {
    swapStmt.run(-(position + 1) * STEP, rows[position].id);
  }
  for (let position = 0; position < rows.length; position += 1) {
    swapStmt.run((position + 1) * STEP, rows[position].id);
  }
}
