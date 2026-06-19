/**
 * planTriggerDispatcher — ANTSCRIPT v1 event→action runner.
 *
 * Synchronous entry-point called from route handlers when plan/task
 * lifecycle changes happen. Looks up matching triggers (plan-specific
 * OR wildcard), executes their actions, records the fire. Failures in
 * one trigger don't abort others — each is logged + skipped.
 *
 * Events (planTriggerStore PLAN_TRIGGER_EVENTS):
 *   plan.completed   — plan transitions to 100% complete
 *   plan.archived    — archivedAtMs set
 *   plan.deleted     — deletedAtMs set (soft)
 *   plan.restored    — archive OR delete cleared
 *   task.created     — new task in a plan
 *   task.completed   — task status → completed
 *   task.blocked     — task status → blocked
 *   task.assigned    — task gains an assigned_agent (null → set, or change)
 *
 * Actions (planTriggerStore PLAN_TRIGGER_ACTIONS):
 *   room.message     — postSystemMessage to every attached room
 *   console.log      — server-side debug log
 *   webhook.post     — POST JSON to external URL
 *   task.create      — auto-create a follow-up task
 *
 * Template placeholders (substituted in any string config field):
 *   {planId} {planTitle} {event} {completedCount} {totalCount} {pct}
 *   {taskId} {taskSubject} {taskStatus} {taskAgent}
 *
 * Standalone-task events (planId=null in ctx) only fire wildcard
 * triggers — there is no plan-scoped subscription possible.
 */

import {
  listTriggers,
  recordTriggerFired,
  type PlanTrigger,
  type PlanTriggerEvent
} from './planTriggerStore';
import { listRoomsForPlan } from './planRoomLinkStore';
import { planCompletion, createTask } from './taskStore';
import { postSystemMessage } from './chatMessageStore';
import { isWebhookUrlSafe, webhookFetchOptions } from './webhookSafety';

export type DispatchContext = {
  /** Plan id the event is scoped to. May be null for standalone-task events. */
  planId: string | null;
  /** Pre-computed completion snapshot if the caller has one (saves a query). */
  completion?: { total: number; completed: number; pct: number; title: string | null };
  /** Task context for task.* events. */
  task?: {
    id: string;
    subject: string;
    status: string;
    assignedAgent: string | null;
  };
};

/** Public entry point. Synchronous; per-trigger errors are swallowed + logged. */
export function dispatchPlanEvent(event: PlanTriggerEvent, ctx: DispatchContext): void {
  let triggers: PlanTrigger[];
  try {
    // planId=null context: only wildcard triggers match (standalone-task
    // events). listTriggers({planId:null}) returns wildcard-only.
    triggers = listTriggers({ planId: ctx.planId, event });
  } catch (cause) {
    console.error('[planTriggerDispatcher] listTriggers failed', cause);
    return;
  }
  if (triggers.length === 0) return;

  const completion = ctx.completion ?? (ctx.planId !== null ? lazyCompletion(ctx.planId) : null);

  for (const t of triggers) {
    runTriggerAction(t, event, ctx, completion);
  }
}

/** Fire exactly one trigger. Used by the manual test endpoint so a single
 * trigger's webhook/message/action can be tested without invoking siblings
 * that happen to share the same plan/event subscription. */
export function dispatchSinglePlanTrigger(t: PlanTrigger, ctx: DispatchContext): boolean {
  const completion = ctx.completion ?? (ctx.planId !== null ? lazyCompletion(ctx.planId) : null);
  return runTriggerAction(t, t.event, ctx, completion);
}

function runTriggerAction(
  t: PlanTrigger,
  event: PlanTriggerEvent,
  ctx: DispatchContext,
  completion: { total: number; completed: number; pct: number; title: string | null } | null
): boolean {
  try {
    runAction(t, event, ctx, completion);
    recordTriggerFired(t.id);
    return true;
  } catch (cause) {
    console.error(
      `[planTriggerDispatcher] trigger ${t.id} (${t.action} on ${event}) failed:`,
      cause
    );
    return false;
  }
}

function lazyCompletion(planId: string): {
  total: number;
  completed: number;
  pct: number;
  title: string | null;
} {
  try {
    const c = planCompletion(planId);
    return { total: c.total, completed: c.completed, pct: c.pct, title: c.title };
  } catch {
    return { total: 0, completed: 0, pct: 0, title: null };
  }
}

function runAction(
  t: PlanTrigger,
  event: PlanTriggerEvent,
  ctx: DispatchContext,
  c: { total: number; completed: number; pct: number; title: string | null } | null
): void {
  const planId = ctx.planId ?? '';
  switch (t.action) {
    case 'console.log': {
      const raw = typeof t.actionConfig.message === 'string'
        ? t.actionConfig.message
        : `[plan-trigger] ${event} on ${planId}`;
      console.log(renderTemplate(raw, event, ctx, c));
      return;
    }
    case 'room.message': {
      if (planId === '') return; // standalone-task events have no rooms
      const tpl = typeof t.actionConfig.messageTemplate === 'string'
        ? t.actionConfig.messageTemplate
        : `Plan **${c?.title ?? planId}** — ${event} (${c?.completed ?? 0}/${c?.total ?? 0}, ${Math.round((c?.pct ?? 0) * 100)}%)`;
      const body = renderTemplate(tpl, event, ctx, c);
      const rooms = listRoomsForPlan(planId);
      if (rooms.length === 0) return;
      for (const r of rooms) {
        try {
          postSystemMessage({ roomId: r.roomId, body });
        } catch (cause) {
          console.error(`[planTriggerDispatcher] postSystemMessage to ${r.roomId} failed:`, cause);
        }
      }
      return;
    }
    case 'webhook.post': {
      const urlTpl = typeof t.actionConfig.url === 'string' ? t.actionConfig.url : '';
      const url = urlTpl === '' ? '' : renderTemplate(urlTpl, event, ctx, c);
      if (url === '') {
        console.warn('[planTriggerDispatcher] webhook.post: missing url in actionConfig');
        return;
      }
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const cfgHeaders = t.actionConfig.headers;
      if (cfgHeaders && typeof cfgHeaders === 'object' && !Array.isArray(cfgHeaders)) {
        for (const [k, v] of Object.entries(cfgHeaders as Record<string, unknown>)) {
          if (typeof v === 'string') headers[k] = renderTemplate(v, event, ctx, c);
        }
      }
      // Body — operator-supplied template wins; otherwise a standard
      // structured payload. Template renders before parse so placeholders
      // inside JSON values work.
      let body: string;
      if (typeof t.actionConfig.bodyTemplate === 'string') {
        body = renderTemplate(t.actionConfig.bodyTemplate, event, ctx, c);
      } else {
        body = JSON.stringify({
          event,
          planId: ctx.planId,
          planTitle: c?.title ?? null,
          completion: c ? { total: c.total, completed: c.completed, pct: c.pct } : null,
          task: ctx.task ?? null,
          firedAtMs: Date.now()
        });
      }
      // Fire-and-forget: triggers should not block the lifecycle PATCH
      // on a slow/unreachable webhook. Errors logged for observability.
      //
      // SSRF guard parity (msg_53bpcfqe9j pre-launch code review): the
      // cron webhook.post action had this guard since 6c55d6d, but this
      // sibling dispatcher was missed. Same `isWebhookUrlSafe` deny-first
      // check + the same safe fetch options (AbortController 10s timeout,
      // redirect:'manual' against post-allowlist 301-bounce, identifiable
      // user-agent) — both webhook fire paths now share `webhookSafety.ts`.
      const safetyCheck = isWebhookUrlSafe(url);
      if (!safetyCheck.ok) {
        console.error(`[planTriggerDispatcher] webhook.post BLOCKED url=${url} reason=${safetyCheck.reason}`);
        return;
      }
      const { init, timeout } = webhookFetchOptions('plan-trigger');
      // Merge operator-supplied headers on top of webhookFetchOptions
      // defaults — but keep our content-type + user-agent unless the
      // operator explicitly overrode them in actionConfig.headers.
      const mergedHeaders: Record<string, string> = {
        ...(init.headers as Record<string, string>),
        ...headers
      };
      fetch(url, { ...init, headers: mergedHeaders, body })
        .catch((cause) => {
          console.error(`[planTriggerDispatcher] webhook.post ${url} failed:`, cause);
        })
        .finally(() => clearTimeout(timeout));
      return;
    }
    case 'task.create': {
      const subjectTpl = typeof t.actionConfig.subject === 'string'
        ? t.actionConfig.subject
        : `Follow-up after ${event}`;
      const subject = renderTemplate(subjectTpl, event, ctx, c);
      const descTpl = typeof t.actionConfig.description === 'string'
        ? t.actionConfig.description
        : null;
      const description = descTpl !== null ? renderTemplate(descTpl, event, ctx, c) : null;
      const priority = typeof t.actionConfig.priority === 'number' ? t.actionConfig.priority : null;
      const assignedAgent = typeof t.actionConfig.assignedAgent === 'string'
        ? t.actionConfig.assignedAgent
        : null;
      // planId routing: "same" → same plan as the firing event; explicit
      // string → that plan; null/missing → standalone task.
      const planSel = t.actionConfig.planId;
      let newPlanId: string | null = null;
      if (planSel === 'same') newPlanId = ctx.planId;
      else if (typeof planSel === 'string') newPlanId = planSel;
      // Recursion guard: a task.create trigger should not chain-create
      // tasks indefinitely if its config accidentally matches its own
      // event. We use a synthetic prefix so a `task.created` trigger on
      // the new task can't loop back into the same trigger row.
      const newId = `auto_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36)}`;
      createTask({
        id: newId,
        subject,
        description,
        priority,
        planId: newPlanId,
        assignedAgent
      });
      return;
    }
    default: {
      console.warn(`[planTriggerDispatcher] unknown action: ${t.action}`);
    }
  }
}

function renderTemplate(
  tpl: string,
  event: PlanTriggerEvent,
  ctx: DispatchContext,
  c: { total: number; completed: number; pct: number; title: string | null } | null
): string {
  const planId = ctx.planId ?? '';
  return tpl
    .replace(/\{planId\}/g, planId)
    .replace(/\{planTitle\}/g, c?.title ?? planId)
    .replace(/\{event\}/g, event)
    .replace(/\{completedCount\}/g, String(c?.completed ?? 0))
    .replace(/\{totalCount\}/g, String(c?.total ?? 0))
    .replace(/\{pct\}/g, String(Math.round((c?.pct ?? 0) * 100)))
    .replace(/\{taskId\}/g, ctx.task?.id ?? '')
    .replace(/\{taskSubject\}/g, ctx.task?.subject ?? '')
    .replace(/\{taskStatus\}/g, ctx.task?.status ?? '')
    .replace(/\{taskAgent\}/g, ctx.task?.assignedAgent ?? '');
}
