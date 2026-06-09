/**
 * taskStore — Lane-D PLANS S1 (canonical RQO32-gated decision-doc
 * docs/lane-d-plans-design-2026-05-15.md).
 *
 * A task is a FIRST-CLASS persisted entity. JWPK Q1: tasks are
 * INDEPENDENT of plans — `plan_id` is OPTIONAL (NULL = standalone). A
 * task is never a child of a plan; the Gantt/donut/board are renders of
 * this entity filtered by `plan_id`.
 *
 * blocks/blocked_by are JSON id-arrays matching the claude
 * `~/.claude/tasks/<sid>/*.json` shape so FINGERPRINT-MANIFEST harvest +
 * B2-7 share ONE dependency graph. Edge mutations keep both sides of the
 * mirror consistent inside a single transaction (no half-edges in the
 * shared tree).
 *
 * The existing in-memory plan-event projection (planModeStore) is
 * intentionally NOT touched by this store.
 */

import { getIdentityDb } from './db';
import { createEntityStore } from './sqliteEntityStore';
import { projectPlanEvents, type EvidenceRef } from './planModeStore';
import { ensurePlanRow } from './planStore';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'deleted';

const TASK_STATUSES: ReadonlySet<string> = new Set<TaskStatus>([
  'pending', 'in_progress', 'blocked', 'completed', 'deleted'
]);

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUSES.has(value);
}

export type WorkspaceKind = 'repo-checkout' | 'isolated-worktree' | 'live-served' | 'unknown';
export type WorkspaceDirtyState = 'clean' | 'dirty' | 'unknown';
export type WorkspaceDriftState = 'match' | 'drifted' | 'missing' | 'unknown';

export type WorkspaceIdentity = {
  repoRoot: string | null;
  launchRoot: string | null;
  branchName: string | null;
  headSha: string | null;
  workspaceKind: WorkspaceKind;
  dirtyState: WorkspaceDirtyState;
  driftState: WorkspaceDriftState;
  lastEvidenceReceipt: string | null;
  changedFiles: string[];
};

export type Task = {
  id: string;
  subject: string;
  description: string | null;
  status: TaskStatus;
  priority: number | null;
  planId: string | null;
  assignedAgent: string | null;
  blocks: string[];
  blockedBy: string[];
  evidence: EvidenceRef[];
  workspaceIdentity: WorkspaceIdentity | null;
  notes: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CreateTaskInput = {
  id: string;
  subject: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: number | null;
  planId?: string | null;
  assignedAgent?: string | null;
  evidence?: EvidenceRef[] | null;
  workspaceIdentity?: WorkspaceIdentity | null;
  notes?: string | null;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
};

export type TaskPatch = {
  subject?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: number | null;
  planId?: string | null;
  assignedAgent?: string | null;
  evidence?: EvidenceRef[] | null;
  workspaceIdentity?: WorkspaceIdentity | null;
  notes?: string | null;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
};

type TaskRow = {
  id: string;
  subject: string;
  description: string | null;
  status: string;
  priority: number | null;
  plan_id: string | null;
  assigned_agent: string | null;
  blocks: string;
  blocked_by: string;
  evidence: string;
  workspace_identity: string | null;
  notes: string | null;
  started_at_ms: number | null;
  ended_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function parseEvidence(raw: string): EvidenceRef[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is EvidenceRef =>
        !!v && typeof v === 'object' && typeof v.kind === 'string' && typeof v.ref === 'string'
    );
  } catch {
    return [];
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function workspaceKindOrUnknown(value: unknown): WorkspaceKind {
  return value === 'repo-checkout' || value === 'isolated-worktree' || value === 'live-served'
    ? value
    : 'unknown';
}

function dirtyStateOrUnknown(value: unknown): WorkspaceDirtyState {
  return value === 'clean' || value === 'dirty' ? value : 'unknown';
}

function driftStateOrUnknown(value: unknown): WorkspaceDriftState {
  return value === 'match' || value === 'drifted' || value === 'missing' ? value : 'unknown';
}

export function normalizeWorkspaceIdentity(value: unknown): WorkspaceIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parsed = value as Record<string, unknown>;
  return {
    repoRoot: stringOrNull(parsed.repoRoot),
    launchRoot: stringOrNull(parsed.launchRoot),
    branchName: stringOrNull(parsed.branchName),
    headSha: stringOrNull(parsed.headSha),
    workspaceKind: workspaceKindOrUnknown(parsed.workspaceKind),
    dirtyState: dirtyStateOrUnknown(parsed.dirtyState),
    driftState: driftStateOrUnknown(parsed.driftState),
    lastEvidenceReceipt: stringOrNull(parsed.lastEvidenceReceipt),
    changedFiles: stringArrayOrEmpty(parsed.changedFiles)
  };
}

function parseWorkspaceIdentity(raw: string | null): WorkspaceIdentity | null {
  if (!raw) return null;
  try {
    return normalizeWorkspaceIdentity(JSON.parse(raw));
  } catch {
    return null;
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    status: (isTaskStatus(row.status) ? row.status : 'pending'),
    priority: row.priority,
    planId: row.plan_id,
    assignedAgent: row.assigned_agent,
    blocks: parseStringArray(row.blocks),
    blockedBy: parseStringArray(row.blocked_by),
    evidence: parseEvidence(row.evidence),
    workspaceIdentity: parseWorkspaceIdentity(row.workspace_identity),
    notes: row.notes,
    startedAtMs: row.started_at_ms,
    endedAtMs: row.ended_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

const TASK_COLUMNS = ['*'];

const { get: getTaskRaw, listOrdered } = createEntityStore<Task, TaskRow>({
  table: 'tasks',
  columns: TASK_COLUMNS,
  rowToDomain: rowToTask
});

export function createTask(input: CreateTaskInput): Task {
  const db = getIdentityDb();
  const now = Date.now();
  const status: TaskStatus = input.status ?? 'pending';
  db.prepare(
    `INSERT INTO tasks (
       id, subject, description, status, priority, plan_id, assigned_agent,
       blocks, blocked_by, evidence, workspace_identity, notes, started_at_ms, ended_at_ms,
       created_at_ms, updated_at_ms
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    input.id,
    input.subject,
    input.description ?? null,
    status,
    input.priority ?? null,
    input.planId ?? null,
    input.assignedAgent ?? null,
    '[]',
    '[]',
    JSON.stringify(input.evidence ?? []),
    input.workspaceIdentity ? JSON.stringify(input.workspaceIdentity) : null,
    input.notes ?? null,
    input.startedAtMs ?? null,
    input.endedAtMs ?? null,
    now,
    now
  );
  // Lane-D plans-lifecycle wiring: a non-null plan_id auto-creates the
  // plans row so lifecycle filters (archived/deleted) have something to
  // toggle. INSERT OR IGNORE — never overwrites an existing plans row.
  if (input.planId !== undefined && input.planId !== null) {
    ensurePlanRow(input.planId);
  }
  const created = getTask(input.id);
  if (!created) throw new Error('createTask: row not found after insert.');
  return created;
}


export function getTask(id: string): Task | null {
  return getTaskRaw(id);
}

export function listTasks(opts: { includeDeleted?: boolean } = {}): Task[] {
  if (opts.includeDeleted) {
    return listOrdered(undefined, 'created_at_ms ASC');
  }
  return listOrdered(`status != 'deleted'`, 'created_at_ms ASC');
}

export function listTasksForPlan(planId: string): Task[] {
  return listOrdered(
    `plan_id = ? AND status != 'deleted'`,
    `priority IS NULL, priority ASC, created_at_ms ASC`,
    [planId]
  );
}


export type TaskForRoom = Task & { planTitle: string | null };
export function listTasksForRoom(roomId: string): TaskForRoom[] {
  const db = getIdentityDb();
  const planRows = db
    .prepare(`SELECT plan_id FROM plan_rooms WHERE room_id = ?`)
    .all(roomId) as { plan_id: string }[];
  const planIds = planRows.map((r) => r.plan_id);

  if (planIds.length === 0) {
    const rows = db
      .prepare(
        `SELECT t.*, p.title as plan_title FROM tasks t
         LEFT JOIN plans p ON t.plan_id = p.id
         WHERE t.plan_id IS NULL AND t.room_id = ? AND t.status != 'deleted'
         ORDER BY t.priority IS NULL, t.priority ASC, t.created_at_ms ASC`
      )
      .all(roomId) as (TaskRow & { plan_title: string | null })[];
    return rows.map((r) => ({ ...rowToTask(r), planTitle: r.plan_title ?? null }));
  }

  const placeholders = planIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT t.*, p.title as plan_title FROM tasks t
       LEFT JOIN plans p ON t.plan_id = p.id
       WHERE (t.plan_id IN (${placeholders}) OR (t.plan_id IS NULL AND t.room_id = ?))
       AND t.status != 'deleted'
       ORDER BY t.plan_id IS NULL, t.priority IS NULL, t.priority ASC, t.created_at_ms ASC`
    )
    .all(...planIds, roomId) as (TaskRow & { plan_title: string | null })[];
  return rows.map((r) => ({ ...rowToTask(r), planTitle: r.plan_title ?? null }));
}

export function updateTask(id: string, patch: TaskPatch): Task | null {
  const existing = getTask(id);
  if (!existing) return null;
  const next = {
    subject: patch.subject ?? existing.subject,
    description: patch.description !== undefined ? patch.description : existing.description,
    status: patch.status ?? existing.status,
    priority: patch.priority !== undefined ? patch.priority : existing.priority,
    plan_id: patch.planId !== undefined ? patch.planId : existing.planId,
    assigned_agent:
      patch.assignedAgent !== undefined ? patch.assignedAgent : existing.assignedAgent,
    evidence: patch.evidence !== undefined ? (patch.evidence ?? []) : existing.evidence,
    workspace_identity:
      patch.workspaceIdentity !== undefined ? patch.workspaceIdentity : existing.workspaceIdentity,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    started_at_ms: patch.startedAtMs !== undefined ? patch.startedAtMs : existing.startedAtMs,
    ended_at_ms: patch.endedAtMs !== undefined ? patch.endedAtMs : existing.endedAtMs
  };
  getIdentityDb()
    .prepare(
      `UPDATE tasks SET
         subject = ?, description = ?, status = ?, priority = ?, plan_id = ?,
         assigned_agent = ?, evidence = ?, workspace_identity = ?, notes = ?, started_at_ms = ?,
         ended_at_ms = ?, updated_at_ms = ?
       WHERE id = ?`
    )
    .run(
      next.subject,
      next.description,
      next.status,
      next.priority,
      next.plan_id,
      next.assigned_agent,
      JSON.stringify(next.evidence),
      next.workspace_identity ? JSON.stringify(next.workspace_identity) : null,
      next.notes,
      next.started_at_ms,
      next.ended_at_ms,
      Date.now(),
      id
    );
  return getTask(id);
}

/** Soft-delete (JWPK SURFACE-SIZE-ONLY: never hard-delete shared rows). */
export function deleteTask(id: string): boolean {
  const result = getIdentityDb()
    .prepare(`UPDATE tasks SET status = 'deleted', updated_at_ms = ? WHERE id = ?`)
    .run(Date.now(), id);
  return result.changes > 0;
}

export class TaskDependencyError extends Error {}

function dependsOnTask(tasks: readonly Task[], startTaskId: string, targetTaskId: string): boolean {
  const blockersByTask = new Map(tasks.map((task) => [task.id, task.blockedBy]));
  const seen = new Set<string>();
  const stack = [startTaskId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || seen.has(currentId)) continue;
    seen.add(currentId);
    for (const blockerId of blockersByTask.get(currentId) ?? []) {
      if (blockerId === targetTaskId) return true;
      stack.push(blockerId);
    }
  }

  return false;
}

/**
 * Add a dependency edge: `taskId` becomes blocked_by `blockerId` and
 * `blockerId` gains `taskId` in its `blocks`. Both sides + updated_at are
 * written in ONE transaction so the shared tree never holds a half-edge.
 */
export function addDependency(taskId: string, blockerId: string): void {
  if (taskId === blockerId) {
    throw new TaskDependencyError('A task cannot depend on itself.');
  }
  const db = getIdentityDb();
  const txn = db.transaction(() => {
    const task = getTask(taskId);
    const blocker = getTask(blockerId);
    if (!task || task.status === 'deleted') {
      throw new TaskDependencyError(`Task ${taskId} not found.`);
    }
    if (!blocker || blocker.status === 'deleted') {
      throw new TaskDependencyError(`Blocker task ${blockerId} not found.`);
    }
    const blockedBy = new Set(task.blockedBy);
    const blocks = new Set(blocker.blocks);
    if (blockedBy.has(blockerId) && blocks.has(taskId)) return; // already linked
    if (dependsOnTask(listTasks(), blockerId, taskId)) {
      throw new TaskDependencyError('Adding this dependency would create a cycle.');
    }
    blockedBy.add(blockerId);
    blocks.add(taskId);
    const now = Date.now();
    db.prepare(`UPDATE tasks SET blocked_by = ?, updated_at_ms = ? WHERE id = ?`)
      .run(JSON.stringify([...blockedBy]), now, taskId);
    db.prepare(`UPDATE tasks SET blocks = ?, updated_at_ms = ? WHERE id = ?`)
      .run(JSON.stringify([...blocks]), now, blockerId);
  });
  txn();
}

/** Remove a dependency edge, mirrored, in one transaction. */
export function removeDependency(taskId: string, blockerId: string): void {
  const db = getIdentityDb();
  const txn = db.transaction(() => {
    const task = getTask(taskId);
    const blocker = getTask(blockerId);
    if (!task || !blocker) return;
    const blockedBy = task.blockedBy.filter((x) => x !== blockerId);
    const blocks = blocker.blocks.filter((x) => x !== taskId);
    const now = Date.now();
    db.prepare(`UPDATE tasks SET blocked_by = ?, updated_at_ms = ? WHERE id = ?`)
      .run(JSON.stringify(blockedBy), now, taskId);
    db.prepare(`UPDATE tasks SET blocks = ?, updated_at_ms = ? WHERE id = ?`)
      .run(JSON.stringify(blocks), now, blockerId);
  });
  txn();
}

export type PlanCompletion = {
  planId: string;
  /**
   * S1.2: human title from the plan's root plan_section event, resolved
   * READ-ONLY (planModeStore is never mutated). null when the plan has no
   * section event — the FE falls back to planId.
   */
  title: string | null;
  total: number;
  completed: number;
  /** 0..1; 0 when the plan has no non-deleted tasks. */
  pct: number;
};

/**
 * Read-only plan title resolution. Order of precedence:
 *   1. plans entity row's `title` column (SQLite, persistent — the v4
 *      lifecycle slice added this; `ant plan create ... --title T` /
 *      `ant plan meta ... --title T` set it).
 *   2. Lowest-order plan_section event from planModeStore (in-memory,
 *      legacy event-sourced — survives only within the running process).
 *   3. null (FE falls back to displaying planId).
 *
 * Putting plans.title first makes the new entity authoritative and
 * survives server restarts; the planModeStore fallback keeps older
 * implicit plans that were bootstrapped via plan_section events working.
 */
function resolvePlanTitle(planId: string): string | null {
  const row = getIdentityDb()
    .prepare(`SELECT title FROM plans WHERE id = ?`)
    .get(planId) as { title: string | null } | undefined;
  if (row && row.title !== null && row.title.trim().length > 0) {
    return row.title;
  }
  for (const event of projectPlanEvents(planId)) {
    if (event.kind === 'plan_section' && event.title.trim().length > 0) {
      return event.title;
    }
  }
  return null;
}

/** Donut metric: completed / total over a plan's non-deleted tasks. */
export function planCompletion(planId: string): PlanCompletion {
  const row = getIdentityDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM tasks
       WHERE plan_id = ? AND status != 'deleted'`
    )
    .get(planId) as { total: number; completed: number | null };
  const total = row.total ?? 0;
  const completed = row.completed ?? 0;
  return {
    planId,
    title: resolvePlanTitle(planId),
    total,
    completed,
    pct: total === 0 ? 0 : completed / total
  };
}

/** Plans-index donut feed: completion per DISTINCT non-null plan_id. */
export function listPlanCompletions(): PlanCompletion[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT DISTINCT plan_id FROM tasks
        WHERE plan_id IS NOT NULL AND status != 'deleted'
        ORDER BY plan_id ASC`
    )
    .all() as { plan_id: string }[];
  return rows.map((r) => planCompletion(r.plan_id));
}

/**
 * Active variant of the plans-index feed: every explicit active plan row,
 * even before tasks are attached, plus legacy implicit plans referenced by
 * tasks. The donut metric itself is unchanged (planCompletion still counts
 * completed/total over non-deleted), so a zero-task room plan renders 0/0
 * instead of disappearing from the cockpit/index.
 *
 * Note: a stricter editorial filter ("planId must also appear in
 * planModeStore.listKnownPlanIds()") was considered but rejected here —
 * planModeStore is in-memory and restart-lossy, so the strict filter
 * empties this list after every restart. Adding it back is gated on
 * persisting plan_events to SQLite, a separate slice.
 */
export function listActivePlanCompletions(): PlanCompletion[] {
  // Explicit active plan rows are first-class and must remain visible even
  // when no task has been attached yet. The UNION keeps legacy implicit
  // plans visible when old tasks reference a plan_id with no plans row.
  const rows = getIdentityDb()
    .prepare(
      `SELECT id AS plan_id FROM plans
        WHERE archived_at_ms IS NULL
          AND deleted_at_ms IS NULL
       UNION
       SELECT DISTINCT tasks.plan_id FROM tasks
         LEFT JOIN plans ON plans.id = tasks.plan_id
        WHERE tasks.plan_id IS NOT NULL
          AND tasks.status != 'deleted'
          AND plans.id IS NULL
        ORDER BY tasks.plan_id ASC`
    )
    .all() as { plan_id: string }[];
  return rows.map((r) => planCompletion(r.plan_id));
}

/**
 * Archived variant of the plans-index feed: only plans whose `plans` row
 * has a non-null `archived_at_ms` AND `deleted_at_ms IS NULL` (deleted
 * takes precedence — a soft-deleted plan never appears here). Used by
 * the /plans "Show archived" toggle to browse archived plans without
 * losing donut completion data. Implicit (no plans row) plans cannot be
 * archived by definition so they never appear here.
 */
export function listArchivedPlanCompletions(): PlanCompletion[] {
  // Driven from the `plans` table (not tasks) so archived plans with
  // zero tasks still appear — a plan can be archived as an entity
  // before any task is added, or after all its tasks have been deleted.
  // planCompletion() returns 0/0 for such cases which is the right
  // donut shape (the card renders "0/0 tasks done"). deleted plans are
  // never archived from a UI standpoint (delete supersedes).
  const rows = getIdentityDb()
    .prepare(
      `SELECT id FROM plans
        WHERE archived_at_ms IS NOT NULL
          AND deleted_at_ms IS NULL
        ORDER BY id ASC`
    )
    .all() as { id: string }[];
  return rows.map((r) => planCompletion(r.id));
}

/**
 * Soft-deleted variant of the plans-index feed: plans whose `plans` row
 * has `deleted_at_ms` set. Mirrors `listArchivedPlanCompletions` — the
 * deleted state takes precedence over archived, so this returns every
 * deleted plan regardless of archive state. Used by the /plans
 * "Show deleted" toggle. Restore via `ant plan restore <plan_id>`.
 */
export function listDeletedPlanCompletions(): PlanCompletion[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id FROM plans
        WHERE deleted_at_ms IS NOT NULL
        ORDER BY id ASC`
    )
    .all() as { id: string }[];
  return rows.map((r) => planCompletion(r.id));
}

export function _resetTaskStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM tasks`).run();
}
