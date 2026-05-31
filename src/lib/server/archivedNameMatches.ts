import { getIdentityDb } from './db';
import { baseName } from './terminalNameTag';

export type ArchivedMatch = {
  id: string;
  name: string;       // current tagged name, e.g. "[A-2] terminal3"
  base: string;       // "terminal3"
  handle: string | null;
  last_seen: number;  // terminals.updated_at (unix seconds)
};

/**
 * Archived terminals whose BASE name equals `base`. Drives the register
 * revive-vs-fresh decision. Handle is pulled from the matching
 * terminal_records row (session_id === terminals.id) when present.
 */
export function listArchivedMatchesForBase(base: string): ArchivedMatch[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT t.id, t.name, t.updated_at, tr.handle
       FROM terminals t
       LEFT JOIN terminal_records tr ON tr.session_id = t.id
      WHERE t.status = 'archived' AND t.name LIKE '[A%] ' || ?
      ORDER BY t.updated_at DESC`
  ).all(base) as Array<{ id: string; name: string; updated_at: number; handle: string | null }>;
  return rows
    .filter((r) => baseName(r.name) === base)
    .map((r) => ({ id: r.id, name: r.name, base, handle: r.handle, last_seen: r.updated_at }));
}
