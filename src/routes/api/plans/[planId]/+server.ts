/**
 * /api/plans/:planId — single-plan surface (Lane-D plans-lifecycle).
 *
 * GET   (public) → 200 { plan } | 404 not found.
 * PATCH (admin)  → body either { action: archive|unarchive|delete|restore }
 *                  OR { title?, description? } metadata patch.
 *                  200 { plan } | 404 unknown | 400 invalid action/body.
 *
 * Auth: admin-bearer for mutations, same model as the link routes.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import {
  archivePlan,
  ensurePlanRow,
  getPlan,
  hardDeletePlan,
  restorePlan,
  restoreDeletedPlan,
  softDeletePlan,
  updatePlan
} from '$lib/server/planStore';
import { getIdentityDb } from '$lib/server/db';
import { dispatchPlanEvent } from '$lib/server/planTriggerDispatcher';
import type { PlanTriggerEvent } from '$lib/server/planTriggerStore';
import { listRoomsForPlan } from '$lib/server/planRoomLinkStore';
import { resolveReadableRoomScope } from '$lib/server/chatRoomReadGate';
import { broadcastPlanChanged, type PlanChangeAction } from '$lib/server/taskPlanRealtime';

const VALID_ACTIONS = new Set(['archive', 'unarchive', 'delete', 'restore', 'hard-delete']);

const ACTION_TO_EVENT: Record<string, PlanTriggerEvent> = {
  archive: 'plan.archived',
  unarchive: 'plan.restored',
  delete: 'plan.deleted',
  restore: 'plan.restored',
  // 'hard-delete' deliberately not in this map — the cascade-delete
  // tears down plan_triggers too, so dispatching post-delete would race
  // an empty table. We emit a one-off audit message in the route handler.
};

/**
 * rv1 data-scoping fix: a single-plan GET previously returned ANY plan by id
 * with no auth. The caller must now be able to read a room hosting the plan
 * (per-room public-read-if-in-room), else the plan is indistinguishable from
 * not-existing (404, not 403 — don't confirm the id exists to a non-member).
 * Admin-bearer keeps full access (containment).
 */
async function requirePlanReadAccess(request: Request, planId: string): Promise<void> {
  const scope = await resolveReadableRoomScope(request);
  if (scope.isAdminBearer) return;
  const hostRooms = listRoomsForPlan(planId);
  if (hostRooms.some((room) => scope.roomIds.has(room.roomId))) return;
  throw error(404, 'plan not found');
}

export const GET: RequestHandler = async ({ params, request }) => {
  const planId = params.planId ?? '';
  if (planId.length === 0) throw error(400, 'planId is required.');
  const plan = getPlan(planId);
  if (!plan) throw error(404, 'plan not found');
  await requirePlanReadAccess(request, planId);
  return json({ plan });
};

function requirePlanMutationAuth(request: Request): void {
  // JWPK msg_n6asvi0j87 (2026-05-19, via ux): operator UI on /plans?show=archived
  // hits 401/403 because requireAdminAuth was admin-bearer-only. Mirror the
  // pattern from /api/plans/[planId]/rooms — accept browser-session cookie
  // OR admin-bearer. Browser sessions are already identity-gated server-side,
  // so the operator's per-room cookie is sufficient proof of intent for a
  // plan mutation.
  if (resolveCallerHandleAnyRoom(request)) return;
  try {
    requireAdminAuth(request);
    return;
  } catch {
    /* fall through */
  }
  throw error(401, 'browser-session or admin-bearer required');
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  requirePlanMutationAuth(request);
  const planId = params.planId ?? '';
  if (planId.length === 0) throw error(400, 'planId is required.');

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object body.');
  }
  const b = body as Record<string, unknown>;

  if ('action' in b) {
    if (typeof b.action !== 'string' || !VALID_ACTIONS.has(b.action)) {
      throw error(400, 'action must be one of archive|unarchive|delete|restore.');
    }
    // Legacy implicit-plan backfill: pre-`ensurePlanRow` data has tasks
    // referencing a plan_id with no matching plans row. On first lifecycle
    // write we materialise the row so archive/delete can proceed without
    // a 404. Gated on "at least one task references it" — random plan_ids
    // still 404 below.
    if (!getPlan(planId)) {
      const taskRef = getIdentityDb()
        .prepare(`SELECT 1 FROM tasks WHERE plan_id = ? LIMIT 1`)
        .get(planId);
      if (taskRef) ensurePlanRow(planId);
    }
    // Capture pre-state so we know whether the action was an actual
    // transition (vs idempotent no-op). Only fire ANTSCRIPT triggers on
    // real transitions — re-archiving an already-archived plan shouldn't
    // re-post the milestone message.
    const before = getPlan(planId);
    if (!before) throw error(404, 'plan not found');
    // JWPK msg_ay9et8k2xp (2026-05-19): hard-delete cascades to tasks +
    // plan_rooms + plan_events + plan_triggers in a single transaction.
    // Returns the deleted plan + a per-table cascadeCount so the UI can
    // show "you deleted PLAN_X and N tasks, M room links, …" on confirm.
    if (b.action === 'hard-delete') {
      // Snapshot hosting rooms BEFORE the cascade tears down plan_rooms —
      // afterwards listRoomsForPlan would resolve to nothing.
      const hostRooms = listRoomsForPlan(planId).map((r) => r.roomId);
      const result = hardDeletePlan(planId);
      if (!result) throw error(404, 'plan not found');
      // Realtime: refresh the Plans panel in every room that hosted it.
      broadcastPlanChanged(planId, { action: 'deleted' }, hostRooms);
      return json({ plan: result.deletedPlan, hardDeleted: true, cascadeCount: result.cascadeCount });
    }
    let next: ReturnType<typeof getPlan> = null;
    switch (b.action) {
      case 'archive':
        next = archivePlan(planId);
        break;
      case 'unarchive':
        next = restorePlan(planId);
        break;
      case 'delete':
        next = softDeletePlan(planId);
        break;
      case 'restore':
        next = restoreDeletedPlan(planId);
        break;
    }
    if (!next) throw error(404, 'plan not found');
    // Transition detection: fire only when the timestamp field that
    // matters for this action actually changed.
    const transitioned =
      (b.action === 'archive'   && before.archivedAtMs === null && next.archivedAtMs !== null) ||
      (b.action === 'unarchive' && before.archivedAtMs !== null && next.archivedAtMs === null) ||
      (b.action === 'delete'    && before.deletedAtMs === null && next.deletedAtMs !== null) ||
      (b.action === 'restore'   && before.deletedAtMs !== null && next.deletedAtMs === null);
    if (transitioned) {
      const event = ACTION_TO_EVENT[b.action];
      if (event) dispatchPlanEvent(event, { planId });
      // Realtime: refresh hosting Plans panels. Soft delete + archive keep
      // plan_rooms links, so listRoomsForPlan still resolves the rooms.
      const rtAction: PlanChangeAction =
        b.action === 'archive' ? 'archived' : b.action === 'delete' ? 'deleted' : 'restored';
      broadcastPlanChanged(planId, { action: rtAction });
    }
    return json({ plan: next });
  }

  // Metadata patch path. Either field may be string or explicit null;
  // omission means "no change" (handled by updatePlan).
  const titlePresent = 'title' in b;
  const descriptionPresent = 'description' in b;
  if (!titlePresent && !descriptionPresent) {
    throw error(400, 'Patch body must include action, title, or description.');
  }
  if (titlePresent && b.title !== null && typeof b.title !== 'string') {
    throw error(400, 'title must be a string or null.');
  }
  if (descriptionPresent && b.description !== null && typeof b.description !== 'string') {
    throw error(400, 'description must be a string or null.');
  }
  const patch: { title?: string | null; description?: string | null } = {};
  if (titlePresent) patch.title = b.title as string | null;
  if (descriptionPresent) patch.description = b.description as string | null;
  const next = updatePlan(planId, patch);
  if (!next) throw error(404, 'plan not found');
  // Realtime: refresh the Plans panel in every room hosting this plan.
  broadcastPlanChanged(planId, { action: 'updated' });
  return json({ plan: next });
};
