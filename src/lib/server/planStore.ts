/**
 * planStore — first-class persisted plan entity (JWPK Q1 evolution).
 *
 * Refactored to use sqliteEntityStore for read-side deduplication.
 * Write operations (create, archive, restore, soft-delete, hard-delete,
 * update, ensurePlanRow) remain entity-specific.
 */

import { getIdentityDb } from './db';
import { createEntityStore } from './sqliteEntityStore';

export type PlanRecord = {
  id: string;
  title: string | null;
  description: string | null;
  createdBy: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number | null;
  deletedAtMs: number | null;
};

export type PlanLifecycleState = 'active' | 'archived' | 'deleted';

type PlanRow = {
  id: string;
  title: string | null;
  description: string | null;
  created_by: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  archived_at_ms: number | null;
  deleted_at_ms: number | null;
};

function rowToPlan(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    archivedAtMs: row.archived_at_ms,
    deletedAtMs: row.deleted_at_ms
  };
}

const PLAN_COLUMNS = ['*'];

const { get: getPlanRaw, listOrdered } = createEntityStore<PlanRecord, PlanRow>({
  table: 'plans',
  columns: PLAN_COLUMNS,
  rowToDomain: rowToPlan
});

export class PlanExistsError extends Error {
  constructor(id: string) {
    super(`Plan ${id} already exists.`);
    this.name = 'PlanExistsError';
  }
}

export function createPlan(input: {
  id: string;
  title?: string | null;
  description?: string | null;
  createdBy?: string | null;
}): PlanRecord {
  const db = getIdentityDb();
  const existing = db.prepare(`SELECT 1 FROM plans WHERE id = ?`).get(input.id);
  if (existing) throw new PlanExistsError(input.id);
  const now = Date.now();
  db.prepare(
    `INSERT INTO plans (id, title, description, created_by, created_at_ms, updated_at_ms, archived_at_ms, deleted_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).run(input.id, input.title ?? null, input.description ?? null, input.createdBy ?? null, now, now);
  const created = getPlan(input.id);
  if (!created) throw new Error('createPlan: row not found after insert.');
  return created;
}

export function getPlan(id: string): PlanRecord | null {
  return getPlanRaw(id);
}

export function listPlans(opts: {
  state?: PlanLifecycleState | 'all';
  limit?: number;
} = {}): PlanRecord[] {
  const state = opts.state ?? 'active';
  let where: string;
  switch (state) {
    case 'active':
      where = `archived_at_ms IS NULL AND deleted_at_ms IS NULL`;
      break;
    case 'archived':
      where = `archived_at_ms IS NOT NULL AND deleted_at_ms IS NULL`;
      break;
    case 'deleted':
      where = `deleted_at_ms IS NOT NULL`;
      break;
    case 'all':
      where = '';
      break;
  }
  const limitClause = typeof opts.limit === 'number' && opts.limit > 0
    ? ` LIMIT ${Math.floor(opts.limit)}`
    : '';
  return listOrdered(where || undefined, `created_at_ms DESC${limitClause}`);
}

export function archivePlan(id: string): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  if (existing.archivedAtMs !== null) return existing;
  const now = Date.now();
  getIdentityDb().prepare(`UPDATE plans SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?`).run(now, now, id);
  return getPlan(id);
}

export function restorePlan(id: string): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  if (existing.archivedAtMs === null) return existing;
  const now = Date.now();
  getIdentityDb().prepare(`UPDATE plans SET archived_at_ms = NULL, updated_at_ms = ? WHERE id = ?`).run(now, id);
  return getPlan(id);
}

export function softDeletePlan(id: string): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  if (existing.deletedAtMs !== null) return existing;
  const now = Date.now();
  getIdentityDb().prepare(`UPDATE plans SET deleted_at_ms = ?, updated_at_ms = ? WHERE id = ?`).run(now, now, id);
  return getPlan(id);
}

export function restoreDeletedPlan(id: string): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  if (existing.deletedAtMs === null) return existing;
  const now = Date.now();
  getIdentityDb().prepare(`UPDATE plans SET deleted_at_ms = NULL, updated_at_ms = ? WHERE id = ?`).run(now, id);
  return getPlan(id);
}

export function hardDeletePlan(id: string): {
  deletedPlan: PlanRecord;
  cascadeCount: { tasks: number; plan_rooms: number; plan_events: number; plan_triggers: number };
} | null {
  const existing = getPlan(id);
  if (!existing) return null;
  const db = getIdentityDb();
  const txn = db.transaction(() => {
    const tasksRes = db.prepare(`DELETE FROM tasks WHERE plan_id = ?`).run(id);
    const roomsRes = db.prepare(`DELETE FROM plan_rooms WHERE plan_id = ?`).run(id);
    const eventsRes = db.prepare(`DELETE FROM plan_events WHERE plan_id = ?`).run(id);
    const triggersRes = db.prepare(`DELETE FROM plan_triggers WHERE plan_id = ?`).run(id);
    db.prepare(`DELETE FROM plans WHERE id = ?`).run(id);
    return {
      tasks: Number(tasksRes.changes),
      plan_rooms: Number(roomsRes.changes),
      plan_events: Number(eventsRes.changes),
      plan_triggers: Number(triggersRes.changes)
    };
  });
  const cascadeCount = txn();
  return { deletedPlan: existing, cascadeCount };
}

export function updatePlan(id: string, patch: { title?: string | null; description?: string | null }): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  const nextTitle = patch.title !== undefined ? patch.title : existing.title;
  const nextDescription = patch.description !== undefined ? patch.description : existing.description;
  getIdentityDb().prepare(`UPDATE plans SET title = ?, description = ?, updated_at_ms = ? WHERE id = ?`).run(nextTitle, nextDescription, Date.now(), id);
  return getPlan(id);
}

export function ensurePlanRow(id: string, opts: { title?: string | null } = {}): PlanRecord {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO plans (id, title, description, created_by, created_at_ms, updated_at_ms, archived_at_ms, deleted_at_ms)
     VALUES (?, ?, NULL, NULL, ?, ?, NULL, NULL)`
  ).run(id, opts.title ?? null, now, now);
  const row = getPlan(id);
  if (!row) throw new Error('ensurePlanRow: row not found after upsert.');
  return row;
}

export function _resetPlanStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM plans`).run();
}
