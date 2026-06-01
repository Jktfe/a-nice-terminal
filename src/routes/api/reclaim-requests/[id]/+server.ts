/**
 * GET /api/reclaim-requests/:id — fetch a single reclaim request by id.
 *
 * PR-C super-admin reclaim CLI primitive (substrate v0.2 plan,
 * 2026-05-29).
 *
 * Auth: admin-bearer ONLY (Stage A scope).
 * 200 → { request: ReclaimRequest }
 * 404 → when no row matches the id.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { getReclaimRequest } from '$lib/server/reclaimRequestsStore';

export const GET: RequestHandler = async ({ request, params }) => {
  requireAdminAuth(request);
  const id = params.id;
  if (!id || id.length === 0) {
    throw error(400, 'reclaim id is required.');
  }
  const row = getReclaimRequest(id);
  if (row === null) {
    throw error(404, `reclaim request not found: ${id}`);
  }
  return json({ request: row });
};
