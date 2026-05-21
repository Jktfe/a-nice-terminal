/**
 * tasksStore — JWPK TASKS-SUBSYSTEM (2026-05-16).
 *
 * The Lane-D PLANS S1 `taskStore.ts` already owns task CRUD against the
 * `tasks` table for the plans/Gantt surface. This store sits ALONGSIDE
 * that one and exposes the JWPK-spec shape:
 *
 *   title / assigned_to / assigned_terminal_id / room_id / parent_task_id
 *   completed_at_ms / created_by / order_index
 *
 * Both stores read+write the same `tasks` table; the columns the JWPK
 * shape needs were added in db.ts as idempotent ALTER TABLE statements.
 * Where the JWPK shape overlaps with Lane-D (status, description), the
 * canonical column is shared. Where it differs (title vs subject), the
 * stores read both and prefer the JWPK column when set.
 *
 * Why a separate file: keep the Lane-D / Gantt code path untouched while
 * the JWPK CLI verbs (`ant task list/create/done/assign`) get a focused,
 * easy-to-grok API. Tests live in `tasksStore.test.ts`.
 *
 * 9-year-old-readable. randomUUID for ids unless caller supplies one.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import { ensurePlanRow } from './planStore';

export type JwpkTaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'blocked';

const JWPK_STATUS_TO_DB: Record<JwpkTaskStatus, string> = {
  todo: 'pending',
  in_progress: 'in_progress',
  done: 'completed',
  cancelled: 'deleted',
  blocked: 'blocked'
};

const DB_TO_JWPK_STATUS: Record<string, JwpkTaskStatus> = {
  pending: 'todo',
  in_progress: 'in_progress',
  blocked: 'blocked',
  completed: 'done',
  deleted: 'cancelled'
};

export function isJwpkTaskStatus(value: unknown): value is JwpkTaskStatus {
  return typeof value === 'string' && value in JWPK_STATUS_TO_DB;
}

export type JwpkTask = {
  id: string;
  title: string;
  description: string;
  status: JwpkTaskStatus;
  assignedTo: string | null;
  assignedTerminalId: string | null;
  roomId: string | null;
  planId: string | null;
  parentTaskId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs: number | null;
  createdBy: string | null;
  orderIndex: number;
};

export type CreateJwpkTaskInput = {
  id?: string;
  title: string;
  description?: string;
  status?: JwpkTaskStatus;
  assignedTo?: string | null;
  assignedTerminalId?: string | null;
  roomId?: string | null;
  planId?: string | null;
  parentTaskId?: string | null;
  createdBy?: string | null;
  orderIndex?: number;
};

export type ListJwpkTasksFilter = {
  status?: JwpkTaskStatus;
  assignedTo?: string;
  assignedTerminalId?: string;
  roomId?: string;
  includeCancelled?: boolean;
};

type TaskRow = {
  id: string;
  subject: string;
  title: string | null;
  description: string | null;
  status: string;
  assigned_agent: string | null;
  assigned_to: string | null;
  assigned_terminal_id: string | null;
  room_id: string | null;
  plan_id: string | null;
  parent_task_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  completed_at_ms: number | null;
  created_by: string | null;
  order_index: number;
};

function rowToTask(row: TaskRow): JwpkTask {
  return {
    id: row.id,
    // JWPK title preferred when set; fall back to the Lane-D `subject`.
    title: (row.title && row.title.length > 0) ? row.title : row.subject,
    description: row.description ?? '',
    status: DB_TO_JWPK_STATUS[row.status] ?? 'todo',
    // JWPK assigned_to preferred; legacy Lane-D assigned_agent as fallback.
    assignedTo: row.assigned_to ?? row.assigned_agent ?? null,
    assignedTerminalId: row.assigned_terminal_id,
    roomId: row.room_id,
    planId: row.plan_id,
    parentTaskId: row.parent_task_id,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    completedAtMs: row.completed_at_ms,
    createdBy: row.created_by,
    orderIndex: row.order_index ?? 0
  };
}

export function createTask(input: CreateJwpkTaskInput): JwpkTask {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    throw new Error('A task needs a non-empty title.');
  }
  const db = getIdentityDb();
  const id = input.id ?? randomUUID();
  const now = Date.now();
  const status: JwpkTaskStatus = input.status ?? 'todo';
  const dbStatus = JWPK_STATUS_TO_DB[status];
  // Lane-D `subject` is NOT NULL — mirror JWPK title into it on insert.
  db.prepare(
    `INSERT INTO tasks (
       id, subject, title, description, status, assigned_to,
       assigned_terminal_id, room_id, plan_id, parent_task_id, created_by,
       order_index, blocks, blocked_by, evidence,
       created_at_ms, updated_at_ms,
       completed_at_ms
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    trimmedTitle,
    trimmedTitle,
    input.description ?? '',
    dbStatus,
    input.assignedTo ?? null,
    input.assignedTerminalId ?? null,
    input.roomId ?? null,
    input.planId ?? null,
    input.parentTaskId ?? null,
    input.createdBy ?? null,
    input.orderIndex ?? 0,
    '[]',
    '[]',
    '[]',
    now,
    now,
    status === 'done' ? now : null
  );
  if (input.planId !== undefined && input.planId !== null) {
    ensurePlanRow(input.planId);
  }
  const created = getTask(id);
  if (!created) throw new Error('createTask: row not found after insert.');
  return created;
}

export function getTask(id: string): JwpkTask | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM tasks WHERE id = ?`)
    .get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function listTasks(filter: ListJwpkTasksFilter = {}): JwpkTask[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!filter.includeCancelled) {
    where.push(`status != 'deleted'`);
  }
  if (filter.status !== undefined) {
    where.push(`status = ?`);
    params.push(JWPK_STATUS_TO_DB[filter.status]);
  }
  if (filter.assignedTo !== undefined) {
    where.push(`(assigned_to = ? OR assigned_agent = ?)`);
    params.push(filter.assignedTo, filter.assignedTo);
  }
  if (filter.assignedTerminalId !== undefined) {
    where.push(`assigned_terminal_id = ?`);
    params.push(filter.assignedTerminalId);
  }
  if (filter.roomId !== undefined) {
    where.push(`room_id = ?`);
    params.push(filter.roomId);
  }
  const whereClause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM tasks${whereClause}
        ORDER BY order_index ASC, created_at_ms ASC`
    )
    .all(...params) as TaskRow[];
  return rows.map(rowToTask);
}

export function updateTaskStatus(id: string, status: JwpkTaskStatus): JwpkTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  const dbStatus = JWPK_STATUS_TO_DB[status];
  const now = Date.now();
  const completedAtMs = status === 'done' ? now : null;
  getIdentityDb()
    .prepare(
      `UPDATE tasks SET status = ?, updated_at_ms = ?, completed_at_ms = ?
       WHERE id = ?`
    )
    .run(dbStatus, now, completedAtMs, id);
  return getTask(id);
}

export function assignTask(id: string, opts: {
  assignedTo?: string | null;
  assignedTerminalId?: string | null;
}): JwpkTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  const next = {
    assigned_to: opts.assignedTo !== undefined ? opts.assignedTo : existing.assignedTo,
    assigned_terminal_id:
      opts.assignedTerminalId !== undefined ? opts.assignedTerminalId : existing.assignedTerminalId
  };
  getIdentityDb()
    .prepare(
      `UPDATE tasks SET assigned_to = ?, assigned_terminal_id = ?, updated_at_ms = ?
       WHERE id = ?`
    )
    .run(next.assigned_to, next.assigned_terminal_id, Date.now(), id);
  return getTask(id);
}

export type PatchJwpkTaskInput = {
  title?: string;
  description?: string;
  status?: JwpkTaskStatus;
  assignedTo?: string | null;
};

export function updateTask(id: string, patch: PatchJwpkTaskInput): JwpkTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  const next = {
    title: patch.title !== undefined ? patch.title.trim() : existing.title,
    description: patch.description !== undefined ? patch.description : existing.description,
    status: patch.status !== undefined ? JWPK_STATUS_TO_DB[patch.status] : JWPK_STATUS_TO_DB[existing.status],
    assigned_to: patch.assignedTo !== undefined ? patch.assignedTo : existing.assignedTo
  };
  const now = Date.now();
  const completedAtMs =
    patch.status === 'done'
      ? now
      : (patch.status !== undefined ? null : existing.completedAtMs);
  getIdentityDb()
    .prepare(
      `UPDATE tasks SET
         subject = ?, title = ?, description = ?, status = ?, assigned_to = ?,
         updated_at_ms = ?, completed_at_ms = ?
       WHERE id = ?`
    )
    .run(
      next.title,
      next.title,
      next.description,
      next.status,
      next.assigned_to,
      now,
      completedAtMs,
      id
    );
  return getTask(id);
}

/** Test-only reset: hard-deletes every row in the tasks table. */
export function resetTasksStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM tasks`).run();
}
