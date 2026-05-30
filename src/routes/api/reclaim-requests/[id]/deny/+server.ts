/**
 * POST /api/reclaim-requests/:id/deny — deny an existing reclaim request.
 *
 * PR-C super-admin reclaim CLI primitive (substrate v0.2 plan,
 * 2026-05-29).
 *
 * Body: { reason: string }
 *   Deny reason is required + recorded in resulting_actions_json so the
 *   audit trail captures why the operator chose not to execute.
 *
 * Auth: admin-bearer ONLY (Stage A scope).
 *
 * 200 → { request: ReclaimRequest }
 * 404 → unknown reclaim id.
 * 409 → request already executed / denied / expired.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  denyReclaim,
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
  if (row.status === 'executed' || row.status === 'denied' || row.status === 'expired') {
    throw error(409, `reclaim ${id} already decided (status=${row.status})`);
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason
      : null;
  if (reason === null) {
    throw error(400, 'reason (non-empty string) is required.');
  }
  const updated = denyReclaim({ reclaimId: id, reason });
  return json({ request: updated });
};
