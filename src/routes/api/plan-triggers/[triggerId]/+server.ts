/**
 * /api/plan-triggers/:triggerId — single-trigger surface.
 *
 * GET    (public)  → 200 { trigger } | 404 not found.
 * DELETE (admin)   → 200 { removed: true } | 404 not found.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdminRequest, requireAdminAuth } from '$lib/server/chatInviteAuth';
import { getTrigger, removeTrigger } from '$lib/server/planTriggerStore';

export const GET: RequestHandler = async ({ params, request }) => {
  const id = params.triggerId ?? '';
  if (id.length === 0) throw error(400, 'triggerId is required.');
  const trigger = getTrigger(id);
  if (!trigger) throw error(404, 'trigger not found');
  return json({
    trigger: isAdminRequest(request)
      ? trigger
      : { ...trigger, actionConfig: {}, actionConfigRedacted: true }
  });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  requireAdminAuth(request);
  const id = params.triggerId ?? '';
  if (id.length === 0) throw error(400, 'triggerId is required.');
  if (!removeTrigger(id)) throw error(404, 'trigger not found');
  return json({ removed: true });
};
