/**
 * sqliteEntityStore — factory for table-per-entity read operations.
 *
 * Extracts the duplicated SELECT column-list + db.prepare boilerplate
 * from stores like askStore, planStore, taskStore. Leaves create/update/
 * delete as entity-specific (validation + business logic vary too much).
 *
 * Phase-1 scope: get + list only. Write operations land in Phase-2 if
 * pilot proves the read-side win is real.
 */

import { getIdentityDb } from './db';

export type EntityStoreConfig<T, R> = {
  table: string;
  columns: string[];
  idColumn?: string;
  rowToDomain: (row: R) => T;
};

export function createEntityStore<T, R>(config: EntityStoreConfig<T, R>) {
  const { table, columns, idColumn = 'id', rowToDomain } = config;
  const colList = columns.join(', ');

  function get(id: string): T | null {
    const row = getIdentityDb()
      .prepare(`SELECT ${colList} FROM ${table} WHERE ${idColumn} = ?`)
      .get(id) as R | undefined;
    return row ? rowToDomain(row) : null;
  }

  function list(whereClause?: string, params?: unknown[]): T[] {
    const sql = whereClause
      ? `SELECT ${colList} FROM ${table} WHERE ${whereClause}`
      : `SELECT ${colList} FROM ${table}`;
    const rows = getIdentityDb().prepare(sql).all(...(params ?? [])) as R[];
    return rows.map(rowToDomain);
  }

  function listOrdered(whereClause?: string, orderBy?: string, params?: unknown[]): T[] {
    let sql = `SELECT ${colList} FROM ${table}`;
    if (whereClause) sql += ` WHERE ${whereClause}`;
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
    const rows = getIdentityDb().prepare(sql).all(...(params ?? [])) as R[];
    return rows.map(rowToDomain);
  }

  return { get, list, listOrdered };
}
