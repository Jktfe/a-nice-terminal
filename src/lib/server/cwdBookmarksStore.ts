/**
 * Persisted store for cwd bookmark pills surfaced under the breadcrumb in
 * TerminalFolderPicker. Mirrors quickShortcutsStore pattern per JWPK
 * 2026-05-15 lock: GLOBAL scope (one shared list across all terminals),
 * server-side persistence in ~/.ant/fresh-ant.db so bookmarks sync across
 * Tailscale devices. Hard-delete only — bookmarks are personal prefs and
 * easy to recreate.
 */
import { getIdentityDb } from './db';

export type CwdBookmark = {
  id: string;
  path: string;
  orderIndex: number;
  createdAtMs: number;
};

type CwdBookmarkRow = {
  id: string;
  path: string;
  order_index: number;
  created_at_ms: number;
};

function makeBookmarkId(): string {
  const fourLetters = Math.random().toString(36).slice(2, 6);
  const sixMore = Math.random().toString(36).slice(2, 8);
  return `${fourLetters}${sixMore}`;
}

function rowToBookmark(row: CwdBookmarkRow): CwdBookmark {
  return {
    id: row.id,
    path: row.path,
    orderIndex: row.order_index,
    createdAtMs: row.created_at_ms
  };
}

function loadBookmarkById(id: string): CwdBookmark | undefined {
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT id, path, order_index, created_at_ms
       FROM cwd_bookmarks WHERE id = ?`
    )
    .get(id) as CwdBookmarkRow | undefined;
  if (!row) return undefined;
  return rowToBookmark(row);
}

export function listCwdBookmarks(): CwdBookmark[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT id, path, order_index, created_at_ms
       FROM cwd_bookmarks
       ORDER BY order_index ASC, created_at_ms ASC`
    )
    .all() as CwdBookmarkRow[];
  return rows.map(rowToBookmark);
}

export function findCwdBookmarkById(id: string): CwdBookmark | undefined {
  return loadBookmarkById(id);
}

/**
 * Create a new bookmark. Returns the existing record (without changes) if
 * the path is already bookmarked — idempotent add so the client doesn't
 * need to dedupe before posting.
 */
export function createCwdBookmark(input: { path: string }): CwdBookmark {
  const trimmedPath = input.path.trim();
  if (trimmedPath.length === 0) {
    throw new Error('A cwd bookmark needs a path with at least one character.');
  }

  const db = getIdentityDb();
  const existing = db
    .prepare(
      `SELECT id, path, order_index, created_at_ms
       FROM cwd_bookmarks WHERE path = ?`
    )
    .get(trimmedPath) as CwdBookmarkRow | undefined;
  if (existing) return rowToBookmark(existing);

  const newId = makeBookmarkId();
  const nowMs = Date.now();

  const txn = db.transaction(() => {
    const nextOrderRow = db
      .prepare(`SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM cwd_bookmarks`)
      .get() as { next: number };
    db.prepare(
      `INSERT INTO cwd_bookmarks
        (id, path, order_index, created_at_ms)
        VALUES (?, ?, ?, ?)`
    ).run(newId, trimmedPath, nextOrderRow.next, nowMs);
  });

  txn();
  return loadBookmarkById(newId)!;
}

export function deleteCwdBookmark(id: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(`DELETE FROM cwd_bookmarks WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function resetCwdBookmarksStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM cwd_bookmarks').run();
}
