/**
 * Persisted store for scoped shortcuts — the saved quick-action library
 * surfaced by `ant settings addterminalshortcut` and
 * `ant settings addchatroomshortcut`.
 *
 * Three scopes share one table:
 *   - 'terminal'  : scope_target = terminalId (sessionId)
 *   - 'chatroom'  : scope_target = roomId
 *   - 'global'    : scope_target = NULL
 *
 * Distinct from the legacy `quick_shortcuts` table — that one is global-only
 * and surfaces the in-page chip bar; this one is scope-aware and feeds the
 * `ant settings listshortcuts [--terminal|--chat]` CLI verb.
 *
 * Hard-delete only — shortcuts are personal prefs, no audit history needed.
 * Follows the chatRoomStore pattern: getIdentityDb() + better-sqlite3 +
 * randomUUID for ids.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type ShortcutScope = 'terminal' | 'chatroom' | 'global';

export type Shortcut = {
  id: string;
  scope: ShortcutScope;
  scopeTarget: string | null;
  label: string;
  command: string;
  orderIndex: number;
  createdAtMs: number;
  createdBy: string | null;
};

type ShortcutRow = {
  id: string;
  scope: ShortcutScope;
  scope_target: string | null;
  label: string;
  command: string;
  order_index: number;
  created_at_ms: number;
  created_by: string | null;
};

function rowToShortcut(row: ShortcutRow): Shortcut {
  return {
    id: row.id,
    scope: row.scope,
    scopeTarget: row.scope_target,
    label: row.label,
    command: row.command,
    orderIndex: row.order_index,
    createdAtMs: row.created_at_ms,
    createdBy: row.created_by
  };
}

function loadShortcutById(id: string): Shortcut | undefined {
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT id, scope, scope_target, label, command, order_index,
              created_at_ms, created_by
       FROM shortcuts WHERE id = ?`
    )
    .get(id) as ShortcutRow | undefined;
  if (!row) return undefined;
  return rowToShortcut(row);
}

/**
 * Insert a new shortcut. orderIndex defaults to MAX+1 within the same
 * (scope, scope_target) bucket so listShortcutsFor returns rows in the
 * order they were added. Trims label + command; throws on blank.
 */
export function addShortcut(input: {
  scope: ShortcutScope;
  scopeTarget?: string | null;
  label: string;
  command: string;
  orderIndex?: number;
  createdBy?: string | null;
}): Shortcut {
  const trimmedLabel = input.label.trim();
  if (trimmedLabel.length === 0) {
    throw new Error('A shortcut needs a label with at least one character.');
  }
  const trimmedCommand = input.command.trim();
  if (trimmedCommand.length === 0) {
    throw new Error('A shortcut needs a command with at least one character.');
  }
  if (input.scope !== 'terminal' && input.scope !== 'chatroom' && input.scope !== 'global') {
    throw new Error(`Unknown shortcut scope: ${String(input.scope)}.`);
  }
  if (input.scope === 'global') {
    if (input.scopeTarget !== undefined && input.scopeTarget !== null && input.scopeTarget !== '') {
      throw new Error('Global shortcuts cannot carry a scope_target.');
    }
  } else {
    const target = (input.scopeTarget ?? '').trim();
    if (target.length === 0) {
      throw new Error(`Scope ${input.scope} requires a non-empty scope_target.`);
    }
  }

  const db = getIdentityDb();
  const newId = randomUUID();
  const nowMs = Date.now();
  const scopeTarget = input.scope === 'global' ? null : (input.scopeTarget ?? '').trim();
  const createdBy = input.createdBy ?? null;

  const insertedId = db.transaction(() => {
    let orderIndex: number;
    if (typeof input.orderIndex === 'number' && Number.isFinite(input.orderIndex)) {
      orderIndex = input.orderIndex;
    } else {
      const nextOrderRow = db
        .prepare(
          `SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM shortcuts
           WHERE scope = ? AND (
             (scope_target IS NULL AND ? IS NULL) OR scope_target = ?
           )`
        )
        .get(input.scope, scopeTarget, scopeTarget) as { next: number };
      orderIndex = nextOrderRow.next;
    }
    db.prepare(
      `INSERT INTO shortcuts
        (id, scope, scope_target, label, command, order_index, created_at_ms, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId, input.scope, scopeTarget, trimmedLabel, trimmedCommand, orderIndex, nowMs, createdBy);
    return newId;
  })();

  return loadShortcutById(insertedId)!;
}

/**
 * List shortcuts in a given scope. When scope is 'global', scopeTarget is
 * ignored; otherwise scope_target must match exactly.
 */
export function listShortcutsFor(
  scope: ShortcutScope,
  scopeTarget?: string | null
): Shortcut[] {
  const db = getIdentityDb();
  if (scope === 'global') {
    const rows = db
      .prepare(
        `SELECT id, scope, scope_target, label, command, order_index,
                created_at_ms, created_by
         FROM shortcuts WHERE scope = 'global'
         ORDER BY order_index ASC, created_at_ms ASC`
      )
      .all() as ShortcutRow[];
    return rows.map(rowToShortcut);
  }
  const target = (scopeTarget ?? '').trim();
  if (target.length === 0) {
    throw new Error(`Scope ${scope} requires a non-empty scope_target.`);
  }
  const rows = db
    .prepare(
      `SELECT id, scope, scope_target, label, command, order_index,
              created_at_ms, created_by
       FROM shortcuts WHERE scope = ? AND scope_target = ?
       ORDER BY order_index ASC, created_at_ms ASC`
    )
    .all(scope, target) as ShortcutRow[];
  return rows.map(rowToShortcut);
}

export function findShortcutById(id: string): Shortcut | undefined {
  return loadShortcutById(id);
}

export function removeShortcut(id: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(`DELETE FROM shortcuts WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function resetShortcutsStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM shortcuts').run();
}
