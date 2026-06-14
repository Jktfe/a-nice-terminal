/**
 * /api/plans — first-class plans collection (Lane-D plans-lifecycle).
 *
 * GET (public) → ?state=active|archived|deleted|all (default 'active')
 *                returns { plans: PlanRecord[] }.
 *                Sibling of /api/plans/completions (task-derived donut feed)
 *                — this surface is the persisted plans-entity list.
 * POST (admin) → body { id, title?, description?, createdBy? }
 *                201 { plan }. 400 missing id. 409 id already exists.
 *
 * Auth: same admin-bearer model used by plan↔room link routes.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  createPlan,
  listPlans,
  PlanExistsError,
  type PlanLifecycleState
} from '$lib/server/planStore';
import { resolveReadableRoomScope } from '$lib/server/chatRoomReadGate';
import { listRoomsForPlan } from '$lib/server/planRoomLinkStore';

function parseState(raw: string | null): PlanLifecycleState | 'all' {
  if (raw === 'archived' || raw === 'deleted' || raw === 'all') return raw;
  // 'active' is the default; any unrecognised value falls back to active
  // rather than 400 so transient client typos don't break a public read.
  return 'active';
}

export const GET: RequestHandler = async ({ url, request }) => {
  // rv1 data-scoping fix: the persisted-plans list previously returned every
  // plan row server-wide. A caller may now only see a plan attached to a room
  // they are a member of; admin-bearer keeps full access (containment).
  const scope = await resolveReadableRoomScope(request);
  const state = parseState(url.searchParams.get('state'));
  const plans = listPlans({ state });
  const scoped = scope.isAdminBearer
    ? plans
    : plans.filter((plan) =>
        listRoomsForPlan(plan.id).some((room) => scope.roomIds.has(room.roomId))
      );
  return json({ plans: scoped });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object body.');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.id !== 'string' || b.id.trim().length === 0) {
    throw error(400, 'id is required.');
  }
  const title = typeof b.title === 'string' ? b.title : null;
  const description = typeof b.description === 'string' ? b.description : null;
  const createdBy = typeof b.createdBy === 'string' ? b.createdBy : null;
  try {
    const plan = createPlan({ id: b.id, title, description, createdBy });
    return json({ plan }, { status: 201 });
  } catch (cause) {
    if (cause instanceof PlanExistsError) throw error(409, cause.message);
    throw cause;
  }
};
