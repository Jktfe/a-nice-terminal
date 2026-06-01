/**
 * planTriggerStore — ANTSCRIPT v1: event → action mappings for plans.
 *
 * A trigger is "when EVENT happens on PLAN, run ACTION". plan_id NULL is
 * a wildcard (any plan). Triggers are stored in SQLite; dispatch is
 * synchronous within the request that emits the event (see
 * planTriggerDispatcher).
 *
 * v1 events:  plan.completed | plan.archived | plan.deleted | plan.restored
 * v1 actions: room.message   | console.log
 *
 * action_config shape per action:
 *   room.message  → { messageTemplate: string, authorHandle?: string }
 *   console.log   → { message: string }
 *
 * Templates support these placeholders, substituted at dispatch time:
 *   {planId} {planTitle} {event} {completedCount} {totalCount} {pct}
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type PlanTriggerEvent =
  // Plan lifecycle events (state changes on the plan record)
  | 'plan.completed'
  | 'plan.archived'
  | 'plan.deleted'
  | 'plan.restored'
  // Task lifecycle events (state changes on individual tasks). These
  // fire for plan-linked tasks only — standalone tasks (plan_id NULL)
  // can still match wildcard triggers because the dispatcher treats
  // planId=null as a valid context.
  | 'task.created'
  | 'task.completed'
  | 'task.blocked'
  | 'task.assigned';

export type PlanTriggerAction =
  | 'room.message'   // postSystemMessage to every attached room
  | 'console.log'    // server-side debug log
  | 'webhook.post'   // POST a JSON body to an HTTP endpoint
  | 'task.create';   // auto-create a follow-up task (planId='same' or explicit)

export const PLAN_TRIGGER_EVENTS: ReadonlySet<PlanTriggerEvent> = new Set([
  'plan.completed', 'plan.archived', 'plan.deleted', 'plan.restored',
  'task.created', 'task.completed', 'task.blocked', 'task.assigned'
]);
export const PLAN_TRIGGER_ACTIONS: ReadonlySet<PlanTriggerAction> = new Set([
  'room.message', 'console.log', 'webhook.post', 'task.create'
]);

export function isPlanTriggerEvent(v: unknown): v is PlanTriggerEvent {
  return typeof v === 'string' && PLAN_TRIGGER_EVENTS.has(v as PlanTriggerEvent);
}
export function isPlanTriggerAction(v: unknown): v is PlanTriggerAction {
  return typeof v === 'string' && PLAN_TRIGGER_ACTIONS.has(v as PlanTriggerAction);
}

export type PlanTrigger = {
  id: string;
  planId: string | null;   // null = wildcard
  event: PlanTriggerEvent;
  action: PlanTriggerAction;
  actionConfig: Record<string, unknown>;
  enabledAtMs: number;
  lastFiredAtMs: number | null;
  fireCount: number;
  createdBy: string | null;
  createdAtMs: number;
};

type TriggerRow = {
  id: string;
  plan_id: string | null;
  event: string;
  action: string;
  action_config: string;
  enabled_at_ms: number;
  last_fired_at_ms: number | null;
  fire_count: number;
  created_by: string | null;
  created_at_ms: number;
};

function rowToTrigger(r: TriggerRow): PlanTrigger {
  let parsed: Record<string, unknown> = {};
  try {
    const v = JSON.parse(r.action_config);
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>;
  } catch {
    /* malformed config: treat as empty */
  }
  return {
    id: r.id,
    planId: r.plan_id,
    event: (isPlanTriggerEvent(r.event) ? r.event : 'plan.completed'),
    action: (isPlanTriggerAction(r.action) ? r.action : 'console.log'),
    actionConfig: parsed,
    enabledAtMs: r.enabled_at_ms,
    lastFiredAtMs: r.last_fired_at_ms,
    fireCount: r.fire_count,
    createdBy: r.created_by,
    createdAtMs: r.created_at_ms
  };
}

export type AddTriggerInput = {
  planId?: string | null;
  event: PlanTriggerEvent;
  action: PlanTriggerAction;
  actionConfig?: Record<string, unknown>;
  createdBy?: string | null;
};

export function addTrigger(input: AddTriggerInput): PlanTrigger {
  const id = `trig_${randomUUID().slice(0, 12)}`;
  const now = Date.now();
  getIdentityDb()
    .prepare(
      `INSERT INTO plan_triggers (
         id, plan_id, event, action, action_config,
         enabled_at_ms, last_fired_at_ms, fire_count,
         created_by, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`
    )
    .run(
      id,
      input.planId ?? null,
      input.event,
      input.action,
      JSON.stringify(input.actionConfig ?? {}),
      now,
      input.createdBy ?? null,
      now
    );
  const created = getTrigger(id);
  if (!created) throw new Error('addTrigger: row not found after insert.');
  return created;
}

export function getTrigger(id: string): PlanTrigger | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM plan_triggers WHERE id = ?`)
    .get(id) as TriggerRow | undefined;
  return row ? rowToTrigger(row) : null;
}

/**
 * List triggers. With no opts: returns ALL triggers. With `planId`:
 * returns triggers matching that plan (specific OR wildcard). With
 * `event`: filter by event. With `planId: null` (explicit): wildcard
 * triggers only.
 */
export function listTriggers(opts: {
  planId?: string | null | undefined;
  event?: PlanTriggerEvent;
} = {}): PlanTrigger[] {
  const where: string[] = [];
  const params: (string | null)[] = [];
  if (opts.planId !== undefined) {
    if (opts.planId === null) {
      where.push(`plan_id IS NULL`);
    } else {
      where.push(`(plan_id = ? OR plan_id IS NULL)`);
      params.push(opts.planId);
    }
  }
  if (opts.event !== undefined) {
    where.push(`event = ?`);
    params.push(opts.event);
  }
  const sql =
    `SELECT * FROM plan_triggers` +
    (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY created_at_ms DESC`;
  const rows = getIdentityDb().prepare(sql).all(...params) as TriggerRow[];
  return rows.map(rowToTrigger);
}

export function removeTrigger(id: string): boolean {
  return getIdentityDb().prepare(`DELETE FROM plan_triggers WHERE id = ?`).run(id).changes > 0;
}

/** Increment fire_count + stamp last_fired_at_ms. Called by dispatcher. */
export function recordTriggerFired(id: string): void {
  getIdentityDb()
    .prepare(
      `UPDATE plan_triggers
          SET fire_count = fire_count + 1, last_fired_at_ms = ?
        WHERE id = ?`
    )
    .run(Date.now(), id);
}

export function _resetPlanTriggerStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM plan_triggers`).run();
}
