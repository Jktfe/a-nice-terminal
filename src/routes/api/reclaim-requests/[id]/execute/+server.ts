/**
 * POST /api/reclaim-requests/:id/execute — run the reclaim primitive for
 * an existing request.
 *
 * PR-C super-admin reclaim CLI primitive (substrate v0.2 plan,
 * 2026-05-29).
 *
 * Body: { dryRun?: boolean, executedByHandle?: string }
 *   dryRun=true returns the actions that WOULD run without touching any
 *   rows or flipping the request status.
 *
 * Auth: admin-bearer ONLY (Stage A scope).
 *
 * 200 → { request: ReclaimRequest, actions: ReclaimAction[] }
 * 404 → unknown reclaim id.
 * 409 → request already executed or already decided (denied / expired).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  executeReclaim,
  getReclaimRequest
} from '$lib/server/reclaimRequestsStore';

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminAuth(request);
  const id = params.id;
  if (!id || id.length === 0) {
    throw error(400, 'reclaim id is required.');
  }
  const row = getReclaimRequest(id);
  if (row === null) {
    throw error(404, `reclaim request not found: ${id}`);
  }
  if (row.status === 'executed') {
    throw error(409, `reclaim ${id} already executed`);
  }
  if (row.status === 'denied' || row.status === 'expired') {
    throw error(409, `reclaim ${id} cannot execute (status=${row.status})`);
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const dryRun = body.dryRun === true;
  const executedByHandle =
    typeof body.executedByHandle === 'string' && body.executedByHandle.length > 0
      ? body.executedByHandle
      : '@admin';
  const result = executeReclaim({ reclaimId: id, executedByHandle, dryRun });
  return json({ request: result.request, actions: result.actions });
};
