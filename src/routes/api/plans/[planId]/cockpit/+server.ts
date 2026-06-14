import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildPlanCockpit } from '$lib/server/planCockpitStore';
import { resolveReadableRoomScope } from '$lib/server/chatRoomReadGate';
import { listRoomsForPlan } from '$lib/server/planRoomLinkStore';

/**
 * rv1 data-scoping fix: the cockpit feed for ANY plan id was readable with no
 * auth (planCockpitStore exposes any plan). The caller must now be a member of
 * a room hosting the plan; otherwise it 404s like a non-existent plan.
 * Admin-bearer keeps full access (containment).
 */
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
  const cockpit = buildPlanCockpit(planId);
  if (!cockpit) throw error(404, 'plan not found');
  return json({ cockpit });
};
