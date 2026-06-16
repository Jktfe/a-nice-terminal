/**
 * GET /api/plans/:planId/visual — seed feed for the ANT Visual Planner.
 *
 * Returns the plan + its tasks shaped as a Visual Plan `model` (the same
 * contract the standalone component + Materialiser use), so the in-app
 * "📐 Visual Plan" button can open the editor pre-loaded from a live plan.
 *
 * Auth mirrors /api/plans/:planId/tasks: caller must be a member of a room
 * hosting the plan, else 404 (admin-bearer keeps full access).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTasksForPlan, planCompletion } from '$lib/server/taskStore';
import { getPlan } from '$lib/server/planStore';
import { resolveReadableRoomScope } from '$lib/server/chatRoomReadGate';
import { listRoomsForPlan } from '$lib/server/planRoomLinkStore';

// Lane-D task priority is a number (1 highest); the Visual Plan uses words.
const PRIORITY_WORD: Record<number, string> = { 1: 'high', 2: 'medium', 3: 'low' };

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

  const tasks = listTasksForPlan(planId);
  const plan = getPlan(planId);
  const completion = planCompletion(planId);
  const subjectById = new Map(tasks.map((t) => [t.id, t.subject]));

  const model = {
    version: 'v1',
    title: plan?.title ?? completion.title ?? planId,
    description: plan?.description ?? '',
    status: 'draft',
    approvedBy: null,
    approvedAtMs: null,
    rooms: listRoomsForPlan(planId).map((room) => room.roomId),
    tasks: tasks.map((t) => ({
      id: t.id,
      subject: t.subject,
      description: t.description ?? '',
      phase: '',
      priority: t.priority !== null ? (PRIORITY_WORD[t.priority] ?? '') : '',
      owner: t.assignedAgent ?? '',
      after: t.blockedBy.map((id) => subjectById.get(id) ?? id),
      doneWhen: t.notes ?? '',
      done: t.status === 'completed'
    }))
  };

  return json({ planId, model });
};
