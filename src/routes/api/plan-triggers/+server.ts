/**
 * /api/plan-triggers — ANTSCRIPT v1 trigger collection.
 *
 * GET ?planId=  → list triggers matching a plan (specific + wildcard).
 *                 Omit planId → list all. Public-read.
 * POST          → create a trigger. Admin. Body:
 *                   { event, action, actionConfig?, planId?, createdBy? }
 *
 *   event:  plan.completed | plan.archived | plan.deleted | plan.restored
 *   action: room.message | console.log
 *
 *   actionConfig per action:
 *     room.message → { messageTemplate: string, authorHandle?: string }
 *     console.log  → { message: string }
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
  listTriggers,
  type PlanTrigger,
  type PlanTriggerEvent
} from '$lib/server/planTriggerStore';

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
      throw error(400, 'event must be plan.completed|plan.archived|plan.deleted|plan.restored.');
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
    throw error(400, 'event must be plan.completed|plan.archived|plan.deleted|plan.restored.');
  }
  if (!isPlanTriggerAction(b.action)) {
    throw error(400, 'action must be room.message|console.log.');
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
