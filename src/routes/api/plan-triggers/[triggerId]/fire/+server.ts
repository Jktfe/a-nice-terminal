/**
 * POST /api/plan-triggers/:triggerId/fire — manual fire (admin).
 *
 * Useful for testing a trigger config without waiting for the real
 * lifecycle event. Body: optional { planId } — defaults to the
 * trigger's planId; required if the trigger is a wildcard (planId
 * NULL) since the dispatcher needs a concrete plan to template
 * against.
 *
 * 200 { fired: true } on success. 404 unknown trigger. 400 when a
 * wildcard trigger is fired without a planId.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { getTrigger } from '$lib/server/planTriggerStore';
import { dispatchPlanEvent } from '$lib/server/planTriggerDispatcher';

export const POST: RequestHandler = async ({ params, request }) => {
  requireAdminAuth(request);
  const id = params.triggerId ?? '';
  if (id.length === 0) throw error(400, 'triggerId is required.');
  const trigger = getTrigger(id);
  if (!trigger) throw error(404, 'trigger not found');

  const body = await request.json().catch(() => ({}));
  const overridePlanId =
    body && typeof body === 'object' && !Array.isArray(body) && typeof (body as Record<string, unknown>).planId === 'string'
      ? ((body as Record<string, string>).planId as string)
      : null;

  const planId = overridePlanId ?? trigger.planId;
  if (!planId) {
    throw error(400, 'wildcard trigger requires a planId in the body to fire.');
  }

  dispatchPlanEvent(trigger.event, { planId });
  return json({ fired: true, triggerId: trigger.id, event: trigger.event, planId });
};
