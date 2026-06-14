/**
 * GET /api/plans/:planId/tasks — Lane-D PLANS S1.
 *
 * Per-plan Gantt feed: the plan's non-deleted tasks (priority-ordered,
 * nulls last) + its completion ratio. Tasks remain first-class — this is
 * a filtered render of the task entity, not a plan-owned collection.
 *
 * rv1 data-scoping fix: previously any caller could read any plan's tasks.
 * The caller must now be a member of a room hosting the plan, else 404
 * (indistinguishable from not-existing). Admin-bearer keeps full access.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTasksForPlan, planCompletion } from '$lib/server/taskStore';
import { resolveReadableRoomScope } from '$lib/server/chatRoomReadGate';
import { listRoomsForPlan } from '$lib/server/planRoomLinkStore';

async function requirePlanReadAccess(request: Request, planId: string): Promise<void> {
  const scope = await resolveReadableRoomScope(request);
  if (scope.isAdminBearer) return;
  if (listRoomsForPlan(planId).some((room) => scope.roomIds.has(room.roomId))) return;
  throw error(404, 'plan not found');
}

export const GET: RequestHandler = async ({ params, request }) => {
  const planId = params.planId ?? '';
  if (planId.trim().length === 0) throw error(400, 'planId is required.');
  await requirePlanReadAccess(request, planId);
  return json({
    planId,
    completion: planCompletion(planId),
    tasks: listTasksForPlan(planId)
  });
};
