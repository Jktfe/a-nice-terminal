/**
 * GET /api/plans/:planId/tasks — Lane-D PLANS S1.
 *
 * Per-plan Gantt feed: the plan's non-deleted tasks (priority-ordered,
 * nulls last) + its completion ratio. Tasks remain first-class — this is
 * a filtered render of the task entity, not a plan-owned collection.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTasksForPlan, planCompletion } from '$lib/server/taskStore';

export const GET: RequestHandler = async ({ params }) => {
  return json({
    planId: params.planId,
    completion: planCompletion(params.planId),
    tasks: listTasksForPlan(params.planId)
  });
};
