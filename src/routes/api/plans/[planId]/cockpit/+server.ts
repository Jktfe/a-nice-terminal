import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildPlanCockpit } from '$lib/server/planCockpitStore';

export const GET: RequestHandler = async ({ params }) => {
  const planId = params.planId ?? '';
  if (planId.trim().length === 0) throw error(400, 'planId is required.');
  const cockpit = buildPlanCockpit(planId);
  if (!cockpit) throw error(404, 'plan not found');
  return json({ cockpit });
};
