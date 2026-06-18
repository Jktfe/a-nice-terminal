/**
 * Persisted store for user-owned Quick Shortcuts — the chips that line the
 * bottom of every terminal and, on click, type literal text into the PTY.
 *
 * Per JWPK 2026-06-18 correction: shortcuts are owned by the logged-in
 * browser-session handle, but shared across all terminals for that owner.
 * Server-side persistence in ~/.ant/fresh-ant.db via
 * better-sqlite3 (mirrors chatRoomStore / terminalRecords pattern), and
 * literal text payload with optional autoEnter (default true sends \r
 * after the text). Hard-delete only — no soft-delete or audit history;
 * shortcuts are personal prefs and easy to recreate.
 */
import { getIdentityDb } from './db';
import { canonicaliseOperatorHandle, getOperatorHandle } from './operatorHandle';

export type QuickShortcut = {
  id: string;
  ownerHandle: string;
  label: string;
  text: string;
  autoEnter: boolean;
  orderIndex: number;
  createdAtMs: number;
  updatedAtMs: number;
};

type QuickShortcutRow = {
  id: string;
  owner_handle: string;
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

function normaliseOwnerHandle(ownerHandle: string | null | undefined): string {
  const fallback = getOperatorHandle();
  const raw = typeof ownerHandle === 'string' && ownerHandle.trim().length > 0
    ? ownerHandle
    : fallback;
  return canonicaliseOperatorHandle(raw);
}

function rowToShortcut(row: QuickShortcutRow): QuickShortcut {
  return {
    id: row.id,
    ownerHandle: row.owner_handle,
    label: row.label,
    text: row.text,
    autoEnter: row.auto_enter === 1,
    orderIndex: row.order_index,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function loadShortcutById(id: string, ownerHandle?: string | null): QuickShortcut | undefined {
  const db = getIdentityDb();
  const owner = normaliseOwnerHandle(ownerHandle);
  const row = db
    .prepare(
      `SELECT id, owner_handle, label, text, auto_enter, order_index, created_at_ms, updated_at_ms
       FROM quick_shortcuts WHERE id = ? AND owner_handle = ?`
    )
    .get(id, owner) as QuickShortcutRow | undefined;
  if (!row) return undefined;
  return rowToShortcut(row);
}

export function listQuickShortcuts(ownerHandle?: string | null): QuickShortcut[] {
  const db = getIdentityDb();
  const owner = normaliseOwnerHandle(ownerHandle);
  const rows = db
    .prepare(
      `SELECT id, owner_handle, label, text, auto_enter, order_index, created_at_ms, updated_at_ms
       FROM quick_shortcuts
       WHERE owner_handle = ?
       ORDER BY order_index ASC, created_at_ms ASC`
    )
    .all(owner) as QuickShortcutRow[];
  return rows.map(rowToShortcut);
}

export function findQuickShortcutById(id: string, ownerHandle?: string | null): QuickShortcut | undefined {
  return loadShortcutById(id, ownerHandle);
}

export function createQuickShortcut(input: {
  ownerHandle?: string | null;
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
  const owner = normaliseOwnerHandle(input.ownerHandle);
  const nowMs = Date.now();
  const autoEnterFlag = input.autoEnter === false ? 0 : 1;

  const txn = db.transaction(() => {
    const nextOrderRow = db
      .prepare(`SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM quick_shortcuts WHERE owner_handle = ?`)
      .get(owner) as { next: number };
    const orderIndex = nextOrderRow.next;
    db.prepare(
      `INSERT INTO quick_shortcuts
        (id, owner_handle, label, text, auto_enter, order_index, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId, owner, trimmedLabel, trimmedText, autoEnterFlag, orderIndex, nowMs, nowMs);
  });

  txn();
  return loadShortcutById(newId, owner)!;
}

export function updateQuickShortcut(
  id: string,
  patch: { label?: string; text?: string; autoEnter?: boolean },
  ownerHandle?: string | null
): QuickShortcut | undefined {
  const owner = normaliseOwnerHandle(ownerHandle);
  const existing = loadShortcutById(id, owner);
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
     WHERE id = ? AND owner_handle = ?`
  ).run(nextLabel, nextText, nextAutoEnter ? 1 : 0, nowMs, id, owner);

  return loadShortcutById(id, owner);
}

export function deleteQuickShortcut(id: string, ownerHandle?: string | null): boolean {
  const db = getIdentityDb();
  const owner = normaliseOwnerHandle(ownerHandle);
  const info = db.prepare(`DELETE FROM quick_shortcuts WHERE id = ? AND owner_handle = ?`).run(id, owner);
  return info.changes > 0;
}

export function reorderQuickShortcuts(
  idsInOrder: string[],
  ownerHandle?: string | null
): QuickShortcut[] {
  const db = getIdentityDb();
  const nowMs = Date.now();
  const owner = normaliseOwnerHandle(ownerHandle);

  const txn = db.transaction(() => {
    const existsStmt = db.prepare(`SELECT 1 AS present FROM quick_shortcuts WHERE id = ? AND owner_handle = ?`);
    const updateStmt = db.prepare(
      `UPDATE quick_shortcuts SET order_index = ?, updated_at_ms = ? WHERE id = ? AND owner_handle = ?`
    );
    let position = 0;
    for (const id of idsInOrder) {
      const present = existsStmt.get(id, owner) as { present: number } | undefined;
      if (!present) continue;
      updateStmt.run(position, nowMs, id, owner);
      position += 1;
    }
  });

  txn();
  return listQuickShortcuts(owner);
}

export function resetQuickShortcutsStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM quick_shortcuts').run();
}
