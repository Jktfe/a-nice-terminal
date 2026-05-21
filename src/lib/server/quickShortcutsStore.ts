/**
 * Persisted store for global Quick Shortcuts — the chips that line the
 * bottom of every terminal and, on click, type literal text into the PTY.
 *
 * Per JWPK 2026-05-15 lock: GLOBAL scope (one shared list across all
 * terminals), server-side persistence in ~/.ant/fresh-ant.db via
 * better-sqlite3 (mirrors chatRoomStore / terminalRecords pattern), and
 * literal text payload with optional autoEnter (default true sends \r
 * after the text). Hard-delete only — no soft-delete or audit history;
 * shortcuts are personal prefs and easy to recreate.
 */
import { getIdentityDb } from './db';

export type QuickShortcut = {
  id: string;
  label: string;
  text: string;
  autoEnter: boolean;
  orderIndex: number;
  createdAtMs: number;
  updatedAtMs: number;
};

type QuickShortcutRow = {
  id: string;
  label: string;
  text: string;
  auto_enter: number;
  order_index: number;
  created_at_ms: number;
  updated_at_ms: number;
};

function makeShortcutId(): string {
  const fourLetters = Math.random().toString(36).slice(2, 6);
  const sixMore = Math.random().toString(36).slice(2, 8);
  return `${fourLetters}${sixMore}`;
}

function rowToShortcut(row: QuickShortcutRow): QuickShortcut {
  return {
    id: row.id,
    label: row.label,
    text: row.text,
    autoEnter: row.auto_enter === 1,
    orderIndex: row.order_index,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function loadShortcutById(id: string): QuickShortcut | undefined {
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT id, label, text, auto_enter, order_index, created_at_ms, updated_at_ms
       FROM quick_shortcuts WHERE id = ?`
    )
    .get(id) as QuickShortcutRow | undefined;
  if (!row) return undefined;
  return rowToShortcut(row);
}

export function listQuickShortcuts(): QuickShortcut[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT id, label, text, auto_enter, order_index, created_at_ms, updated_at_ms
       FROM quick_shortcuts
       ORDER BY order_index ASC, created_at_ms ASC`
    )
    .all() as QuickShortcutRow[];
  return rows.map(rowToShortcut);
}

export function findQuickShortcutById(id: string): QuickShortcut | undefined {
  return loadShortcutById(id);
}

export function createQuickShortcut(input: {
  label: string;
  text: string;
  autoEnter?: boolean;
}): QuickShortcut {
  const trimmedLabel = input.label.trim();
  if (trimmedLabel.length === 0) {
    throw new Error('A quick shortcut needs a label with at least one character.');
  }
  const trimmedText = input.text.trim();
  if (trimmedText.length === 0) {
    throw new Error('A quick shortcut needs text with at least one character.');
  }

  const db = getIdentityDb();
  const newId = makeShortcutId();
  const nowMs = Date.now();
  const autoEnterFlag = input.autoEnter === false ? 0 : 1;

  const txn = db.transaction(() => {
    const nextOrderRow = db
      .prepare(`SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM quick_shortcuts`)
      .get() as { next: number };
    const orderIndex = nextOrderRow.next;
    db.prepare(
      `INSERT INTO quick_shortcuts
        (id, label, text, auto_enter, order_index, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(newId, trimmedLabel, trimmedText, autoEnterFlag, orderIndex, nowMs, nowMs);
  });

  txn();
  return loadShortcutById(newId)!;
}

export function updateQuickShortcut(
  id: string,
  patch: { label?: string; text?: string; autoEnter?: boolean }
): QuickShortcut | undefined {
  const existing = loadShortcutById(id);
  if (!existing) return undefined;

  let nextLabel = existing.label;
  if (patch.label !== undefined) {
    const trimmed = patch.label.trim();
    if (trimmed.length === 0) {
      throw new Error('A quick shortcut label cannot be blank.');
    }
    nextLabel = trimmed;
  }

  let nextText = existing.text;
  if (patch.text !== undefined) {
    const trimmed = patch.text.trim();
    if (trimmed.length === 0) {
      throw new Error('A quick shortcut text cannot be blank.');
    }
    nextText = trimmed;
  }

  const nextAutoEnter =
    patch.autoEnter === undefined ? existing.autoEnter : patch.autoEnter !== false;

  const db = getIdentityDb();
  const nowMs = Date.now();
  db.prepare(
    `UPDATE quick_shortcuts
     SET label = ?, text = ?, auto_enter = ?, updated_at_ms = ?
     WHERE id = ?`
  ).run(nextLabel, nextText, nextAutoEnter ? 1 : 0, nowMs, id);

  return loadShortcutById(id);
}

export function deleteQuickShortcut(id: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(`DELETE FROM quick_shortcuts WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function reorderQuickShortcuts(idsInOrder: string[]): QuickShortcut[] {
  const db = getIdentityDb();
  const nowMs = Date.now();

  const txn = db.transaction(() => {
    const existsStmt = db.prepare(`SELECT 1 AS present FROM quick_shortcuts WHERE id = ?`);
    const updateStmt = db.prepare(
      `UPDATE quick_shortcuts SET order_index = ?, updated_at_ms = ? WHERE id = ?`
    );
    let position = 0;
    for (const id of idsInOrder) {
      const present = existsStmt.get(id) as { present: number } | undefined;
      if (!present) continue;
      updateStmt.run(position, nowMs, id);
      position += 1;
    }
  });

  txn();
  return listQuickShortcuts();
}

export function resetQuickShortcutsStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM quick_shortcuts').run();
}
