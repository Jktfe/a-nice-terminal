/**
 * /api/plan-triggers — ANTSCRIPT v1 trigger collection.
 *
 * GET ?planId=  → list triggers matching a plan (specific + wildcard).
 *                 Omit planId → list all. Public-read.
 * POST          → create a trigger. Admin. Body:
 *                   { event, action, actionConfig?, planId?, createdBy? }
 *
 *   event:  PLAN_TRIGGER_EVENTS from $lib/server/planTriggerStore
 *   action: PLAN_TRIGGER_ACTIONS from $lib/server/planTriggerStore
 *
 *   actionConfig per action:
 *     room.message → { messageTemplate: string, authorHandle?: string }
 *     console.log  → { message: string }
 *     webhook.post → { url: string, bodyTemplate?: string, headers?: object }
 *     task.create  → { subject?: string, description?: string, planId?: string }
 *
 *   planId null/omitted = wildcard (any plan).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdminRequest, requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  addTrigger,
  isPlanTriggerAction,
  isPlanTriggerEvent,
  PLAN_TRIGGER_ACTIONS,
  PLAN_TRIGGER_EVENTS,
  listTriggers,
  type PlanTrigger,
  type PlanTriggerEvent
} from '$lib/server/planTriggerStore';

const EVENT_ERROR = `event must be ${Array.from(PLAN_TRIGGER_EVENTS).sort().join('|')}.`;
const ACTION_ERROR = `action must be ${Array.from(PLAN_TRIGGER_ACTIONS).sort().join('|')}.`;

function readableTrigger(trigger: PlanTrigger, includeConfig: boolean): PlanTrigger & { actionConfigRedacted?: boolean } {
  if (includeConfig) return trigger;
  return { ...trigger, actionConfig: {}, actionConfigRedacted: true };
}

export const GET: RequestHandler = async ({ request, url }) => {
  const planIdParam = url.searchParams.get('planId');
  const eventParam = url.searchParams.get('event');
  const opts: { planId?: string | null; event?: PlanTriggerEvent } = {};
  if (planIdParam !== null) opts.planId = planIdParam.length === 0 ? null : planIdParam;
  if (eventParam) {
    if (!isPlanTriggerEvent(eventParam)) {
      throw error(400, EVENT_ERROR);
    }
    opts.event = eventParam;
  }
  const includeConfig = isAdminRequest(request);
  return json({ triggers: listTriggers(opts).map((trigger) => readableTrigger(trigger, includeConfig)) });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object body.');
  }
  const b = body as Record<string, unknown>;
  if (!isPlanTriggerEvent(b.event)) {
    throw error(400, EVENT_ERROR);
  }
  if (!isPlanTriggerAction(b.action)) {
    throw error(400, ACTION_ERROR);
  }
  const actionConfig =
    b.actionConfig && typeof b.actionConfig === 'object' && !Array.isArray(b.actionConfig)
      ? (b.actionConfig as Record<string, unknown>)
      : {};
  const planId = 'planId' in b && b.planId !== null && b.planId !== '' && typeof b.planId === 'string'
    ? b.planId
    : null;
  const createdBy = typeof b.createdBy === 'string' ? b.createdBy : null;
  const trigger = addTrigger({
    planId,
    event: b.event,
    action: b.action,
    actionConfig,
    createdBy
  });
  return json({ trigger }, { status: 201 });
};
