/**
 * /api/tasks/outcomes — delivery-signal READ for the task-outcome
 * instrument (GEPA-for-ANT step 1: instrument, don't optimise).
 *
 * GET → the aggregate delivery signal: counts of clean / reopened /
 *       corrected / abandoned over the LATEST outcome per task, plus the
 *       headline cleanRatio = clean / (clean + reopened + corrected).
 *
 * Admin-bearer only — this is a cross-task observability read with no room
 * scope, matching the containment posture of the no-room GET on
 * /api/tasks (see that route's "admin-bearer only tonight" comments).
 *
 * Read-only: never mutates. The backfill is NOT exposed over HTTP (it is a
 * store function run deliberately), so this route can't trigger writes.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deliverySignal } from '$lib/server/taskOutcomesStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request)) {
    throw error(401, 'Authentication required.');
  }
  return json({ signal: deliverySignal() });
};
