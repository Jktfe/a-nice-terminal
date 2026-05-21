/**
 * planStore — first-class persisted plan entity (JWPK Q1 evolution).
 *
 * Plans were implicit-only (any `plan_id` referenced elsewhere counted as
 * a "plan"). This store gives plans an optional explicit row so they can
 * carry a title, description, and lifecycle state (active / archived /
 * deleted). No FK is enforced on `tasks.plan_id` or `plan_rooms.plan_id`,
 * so legacy implicit plans (a plan_id with no plans row) keep working.
 *
 * Lifecycle is timestamp-derived rather than an enum column so we can
 * keep the "archived_at_ms" + "deleted_at_ms" pattern already used for
 * chat_rooms / screenshots. deleted_at_ms takes precedence over
 * archived_at_ms (a deleted plan is `deleted`, regardless of archive
 * state) — same precedence rule used by other lifecycle-by-timestamp
 * surfaces in this codebase. SURFACE-SIZE-ONLY: no auto-purge.
 *
 * `ensurePlanRow(id)` is the auto-create hook other stores use so that
 * referencing a plan_id (e.g. via createTask) creates the row lazily and
 * pre-populates the lifecycle filters used by listActivePlanCompletions.
 */

import { getIdentityDb } from './db';

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
    `INSERT INTO plans (
       id, title, description, created_by, created_at_ms, updated_at_ms,
       archived_at_ms, deleted_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).run(
    input.id,
    input.title ?? null,
    input.description ?? null,
    input.createdBy ?? null,
    now,
    now
  );
  const created = getPlan(input.id);
  if (!created) throw new Error('createPlan: row not found after insert.');
  return created;
}

export function getPlan(id: string): PlanRecord | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM plans WHERE id = ?`)
    .get(id) as PlanRow | undefined;
  return row ? rowToPlan(row) : null;
}

export function listPlans(opts: {
  state?: PlanLifecycleState | 'all';
  limit?: number;
} = {}): PlanRecord[] {
  const state = opts.state ?? 'active';
  let where: string;
  switch (state) {
    case 'active':
      where = `WHERE archived_at_ms IS NULL AND deleted_at_ms IS NULL`;
      break;
    case 'archived':
      // deleted_at_ms takes precedence — only show archived-but-not-deleted.
      where = `WHERE archived_at_ms IS NOT NULL AND deleted_at_ms IS NULL`;
      break;
    case 'deleted':
      where = `WHERE deleted_at_ms IS NOT NULL`;
      break;
    case 'all':
      where = '';
      break;
  }
  const limitClause = typeof opts.limit === 'number' && opts.limit > 0
    ? ` LIMIT ${Math.floor(opts.limit)}`
    : '';
  const rows = getIdentityDb()
    .prepare(`SELECT * FROM plans ${where} ORDER BY created_at_ms DESC${limitClause}`)
    .all() as PlanRow[];
  return rows.map(rowToPlan);
}

export function archivePlan(id: string): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  if (existing.archivedAtMs !== null) return existing; // idempotent no-op
  const now = Date.now();
  getIdentityDb()
    .prepare(`UPDATE plans SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?`)
    .run(now, now, id);
  return getPlan(id);
}

export function restorePlan(id: string): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  if (existing.archivedAtMs === null) return existing; // idempotent no-op
  const now = Date.now();
  getIdentityDb()
    .prepare(`UPDATE plans SET archived_at_ms = NULL, updated_at_ms = ? WHERE id = ?`)
    .run(now, id);
  return getPlan(id);
}

export function softDeletePlan(id: string): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  if (existing.deletedAtMs !== null) return existing; // idempotent no-op
  const now = Date.now();
  getIdentityDb()
    .prepare(`UPDATE plans SET deleted_at_ms = ?, updated_at_ms = ? WHERE id = ?`)
    .run(now, now, id);
  return getPlan(id);
}

export function restoreDeletedPlan(id: string): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  if (existing.deletedAtMs === null) return existing; // idempotent no-op
  const now = Date.now();
  getIdentityDb()
    .prepare(`UPDATE plans SET deleted_at_ms = NULL, updated_at_ms = ? WHERE id = ?`)
    .run(now, id);
  return getPlan(id);
}

/**
 * JWPK msg_mpdr8q9p43 + msg_ay9et8k2xp (2026-05-19) — cascade hard-delete.
 * Unlike softDeletePlan (which sets deleted_at_ms + leaves rows intact),
 * this physically removes the plan + every row that referenced it. Single
 * transaction — all-or-nothing.
 *
 * Cascade scope (JWPK "Cascade" verdict): linked tasks DELETE along with
 * the plan rather than orphan with planId=null. Soft-delete is the safety
 * net for "keep the work, remove the plan"; hard-delete means "this plan +
 * all its work is gone".
 *
 * Returns { deletedPlan, cascadeCount: { tasks, plan_rooms, plan_events,
 * plan_triggers } } so the caller can show a count-on-confirm UI line.
 * Returns null if the plan didn't exist (caller throws 404).
 */
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

export function updatePlan(
  id: string,
  patch: { title?: string | null; description?: string | null }
): PlanRecord | null {
  const existing = getPlan(id);
  if (!existing) return null;
  const nextTitle = patch.title !== undefined ? patch.title : existing.title;
  const nextDescription =
    patch.description !== undefined ? patch.description : existing.description;
  getIdentityDb()
    .prepare(
      `UPDATE plans SET title = ?, description = ?, updated_at_ms = ? WHERE id = ?`
    )
    .run(nextTitle, nextDescription, Date.now(), id);
  return getPlan(id);
}

/**
 * INSERT OR IGNORE. Called by other stores when they reference a plan_id
 * so the plan row exists for lifecycle/state filters — but never
 * overwrites an existing row (idempotent, title from opts only used on
 * first insert).
 */
export function ensurePlanRow(
  id: string,
  opts: { title?: string | null } = {}
): PlanRecord {
  const db = getIdentityDb();
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO plans (
       id, title, description, created_by, created_at_ms, updated_at_ms,
       archived_at_ms, deleted_at_ms
     ) VALUES (?, ?, NULL, NULL, ?, ?, NULL, NULL)`
  ).run(id, opts.title ?? null, now, now);
  const row = getPlan(id);
  if (!row) throw new Error('ensurePlanRow: row not found after upsert.');
  return row;
}

export function _resetPlanStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM plans`).run();
}
