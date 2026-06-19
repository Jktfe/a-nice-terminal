/**
 * cronJobStore — operator-defined recurring jobs (JWPK msg_hjv6ac64zo
 * 2026-05-19). Each job has a named lifecycle (start / stop / pause /
 * delete), an interval, and an action that piggy-backs on the existing
 * plan-trigger dispatcher (room.message / console.log / webhook.post /
 * task.create).
 *
 * The ticker (cronJobTicker.ts) reads `status='running' AND next_fire_at_ms
 * <= now()` rows on a setInterval, fires each one, then advances
 * next_fire_at_ms by interval_ms. This keeps the SQL primitive and lets
 * us swap the ticker for a cron-expression engine later without touching
 * the store API.
 *
 * v1 schedule: interval_ms only. v2 widen: schedule_kind='cron' +
 * cron_expr. The schema accepts both; the v1 ticker ignores cron rows
 * with a TODO log so the table doesn't lie about what it'll execute.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type CronJobStatus = 'running' | 'paused' | 'stopped' | 'deleted';
export type CronJobAction = 'room.message' | 'console.log' | 'webhook.post' | 'task.create';
export type CronJobScheduleKind = 'interval' | 'cron';
export type CronJobOutcomeStatus = 'succeeded' | 'skipped' | 'blocked' | 'failed';

export type CronJobOutcome = {
  status: CronJobOutcomeStatus;
  message: string;
};

export type CronJob = {
  id: string;
  name: string;
  status: CronJobStatus;
  scheduleKind: CronJobScheduleKind;
  intervalMs: number | null;
  cronExpr: string | null;
  targetRoomId: string | null;
  targetMessageTemplate: string | null;
  action: CronJobAction;
  actionConfig: Record<string, unknown>;
  createdByHandle: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  lastFiredAtMs: number | null;
  nextFireAtMs: number | null;
  fireCount: number;
  lastOutcomeStatus: CronJobOutcomeStatus | null;
  lastOutcomeMessage: string | null;
  lastOutcomeAtMs: number | null;
};

type CronJobRow = {
  id: string;
  name: string;
  status: string;
  schedule_kind: string;
  interval_ms: number | null;
  cron_expr: string | null;
  target_room_id: string | null;
  target_message_template: string | null;
  action: string;
  action_config: string;
  created_by_handle: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  last_fired_at_ms: number | null;
  next_fire_at_ms: number | null;
  fire_count: number;
  last_outcome_status: string | null;
  last_outcome_message: string | null;
  last_outcome_at_ms: number | null;
};

const VALID_STATUS = new Set<CronJobStatus>(['running', 'paused', 'stopped', 'deleted']);
const VALID_ACTION = new Set<CronJobAction>(['room.message', 'console.log', 'webhook.post', 'task.create']);
const VALID_OUTCOME = new Set<CronJobOutcomeStatus>(['succeeded', 'skipped', 'blocked', 'failed']);

function rowToJob(row: CronJobRow): CronJob {
  let parsedConfig: Record<string, unknown> = {};
  try {
    const candidate = JSON.parse(row.action_config);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsedConfig = candidate as Record<string, unknown>;
    }
  } catch { /* keep empty */ }
  return {
    id: row.id,
    name: row.name,
    status: VALID_STATUS.has(row.status as CronJobStatus) ? (row.status as CronJobStatus) : 'stopped',
    scheduleKind: row.schedule_kind === 'cron' ? 'cron' : 'interval',
    intervalMs: row.interval_ms,
    cronExpr: row.cron_expr,
    targetRoomId: row.target_room_id,
    targetMessageTemplate: row.target_message_template,
    action: VALID_ACTION.has(row.action as CronJobAction) ? (row.action as CronJobAction) : 'room.message',
    actionConfig: parsedConfig,
    createdByHandle: row.created_by_handle,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    lastFiredAtMs: row.last_fired_at_ms,
    nextFireAtMs: row.next_fire_at_ms,
    fireCount: row.fire_count,
    lastOutcomeStatus: VALID_OUTCOME.has(row.last_outcome_status as CronJobOutcomeStatus)
      ? (row.last_outcome_status as CronJobOutcomeStatus)
      : null,
    lastOutcomeMessage: row.last_outcome_message,
    lastOutcomeAtMs: row.last_outcome_at_ms
  };
}

export type CreateCronJobInput = {
  name: string;
  intervalMs: number;
  action?: CronJobAction;
  actionConfig?: Record<string, unknown>;
  targetRoomId?: string | null;
  targetMessageTemplate?: string | null;
  createdByHandle?: string | null;
  startImmediately?: boolean;
  nowMs?: number;
};

export function createCronJob(input: CreateCronJobInput): CronJob {
  const name = input.name.trim();
  if (name.length === 0) throw new Error('cron job name must be a non-empty string');
  if (!Number.isFinite(input.intervalMs) || input.intervalMs < 1_000) {
    throw new Error('cron job intervalMs must be >= 1000ms');
  }
  const action = input.action ?? 'room.message';
  if (!VALID_ACTION.has(action)) throw new Error(`unsupported action: ${action}`);
  const nowMs = input.nowMs ?? Date.now();
  const id = randomUUID();
  const status: CronJobStatus = input.startImmediately ? 'running' : 'paused';
  const nextFireAtMs = status === 'running' ? nowMs + input.intervalMs : null;
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO cron_jobs (
       id, name, status, schedule_kind, interval_ms, cron_expr,
       target_room_id, target_message_template, action, action_config,
       created_by_handle, created_at_ms, updated_at_ms,
       last_fired_at_ms, next_fire_at_ms, fire_count
     ) VALUES (?, ?, ?, 'interval', ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0)`
  ).run(
    id,
    name,
    status,
    input.intervalMs,
    input.targetRoomId ?? null,
    input.targetMessageTemplate ?? null,
    action,
    JSON.stringify(input.actionConfig ?? {}),
    input.createdByHandle ?? null,
    nowMs,
    nowMs,
    nextFireAtMs
  );
  return getCronJob(id) as CronJob;
}

export function getCronJob(id: string): CronJob | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM cron_jobs WHERE id = ?`).get(id) as CronJobRow | undefined;
  return row ? rowToJob(row) : null;
}

export type ListCronJobsFilter = {
  includeDeleted?: boolean;
  createdByHandle?: string;
};

export function listCronJobs(filter: ListCronJobsFilter = {}): CronJob[] {
  const db = getIdentityDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!filter.includeDeleted) where.push(`status != 'deleted'`);
  if (filter.createdByHandle) {
    where.push(`created_by_handle = ?`);
    params.push(filter.createdByHandle);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM cron_jobs ${whereClause} ORDER BY created_at_ms DESC`
  ).all(...params) as CronJobRow[];
  return rows.map(rowToJob);
}

function applyStatusTransition(id: string, nextStatus: CronJobStatus, nowMs: number): CronJob | null {
  const db = getIdentityDb();
  const existing = getCronJob(id);
  if (!existing) return null;
  if (existing.status === 'deleted') return existing;
  if (nextStatus === 'running' && (existing.intervalMs ?? 0) <= 0) {
    throw new Error('cannot start a cron job with no interval set');
  }
  const nextFireAtMs = nextStatus === 'running'
    ? nowMs + (existing.intervalMs ?? 0)
    : null;
  db.prepare(
    `UPDATE cron_jobs
        SET status = ?,
            next_fire_at_ms = ?,
            updated_at_ms = ?
      WHERE id = ?`
  ).run(nextStatus, nextFireAtMs, nowMs, id);
  return getCronJob(id);
}

export function startCronJob(id: string, nowMs: number = Date.now()): CronJob | null {
  return applyStatusTransition(id, 'running', nowMs);
}
export function pauseCronJob(id: string, nowMs: number = Date.now()): CronJob | null {
  return applyStatusTransition(id, 'paused', nowMs);
}
export function stopCronJob(id: string, nowMs: number = Date.now()): CronJob | null {
  return applyStatusTransition(id, 'stopped', nowMs);
}
export function deleteCronJob(id: string, nowMs: number = Date.now()): CronJob | null {
  return applyStatusTransition(id, 'deleted', nowMs);
}

export type RenameCronJobInput = { id: string; name: string; nowMs?: number };
export function renameCronJob(input: RenameCronJobInput): CronJob | null {
  const trimmed = input.name.trim();
  if (trimmed.length === 0) throw new Error('cron job name must be a non-empty string');
  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const info = db.prepare(
    `UPDATE cron_jobs SET name = ?, updated_at_ms = ? WHERE id = ? AND status != 'deleted'`
  ).run(trimmed, nowMs, input.id);
  if (info.changes === 0) return null;
  return getCronJob(input.id);
}

/**
 * Mark a job as having fired + advance next_fire_at_ms by the interval.
 * Called by the ticker after the action runs; idempotent on the row level
 * because we always anchor next-fire to `now + intervalMs` (drift is
 * acceptable for a polling-tick model).
 */
export function recordCronJobFired(
  id: string,
  nowMs: number = Date.now(),
  outcome: CronJobOutcome = { status: 'succeeded', message: 'Job action completed.' }
): CronJob | null {
  const db = getIdentityDb();
  const existing = getCronJob(id);
  if (!existing) return null;
  const nextFireAtMs = existing.status === 'running' && existing.intervalMs
    ? nowMs + existing.intervalMs
    : null;
  db.prepare(
    `UPDATE cron_jobs
        SET last_fired_at_ms = ?,
            next_fire_at_ms = ?,
            fire_count = fire_count + 1,
            last_outcome_status = ?,
            last_outcome_message = ?,
            last_outcome_at_ms = ?,
            updated_at_ms = ?
      WHERE id = ?`
  ).run(nowMs, nextFireAtMs, outcome.status, outcome.message, nowMs, nowMs, id);
  return getCronJob(id);
}

/**
 * Ticker support: list running jobs whose next_fire_at_ms is in the past.
 * Returned newest-overdue first so the most-stale rows fire first under
 * load. Limit caps the per-tick work so a misconfigured 1-sec-interval
 * job can't starve the loop.
 */
export function listDueCronJobs(nowMs: number = Date.now(), limit: number = 50): CronJob[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT * FROM cron_jobs
        WHERE status = 'running'
          AND schedule_kind = 'interval'
          AND next_fire_at_ms IS NOT NULL
          AND next_fire_at_ms <= ?
     ORDER BY next_fire_at_ms ASC
     LIMIT ?`
  ).all(nowMs, limit) as CronJobRow[];
  return rows.map(rowToJob);
}
