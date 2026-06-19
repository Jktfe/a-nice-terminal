/**
 * GET /api/usage — current open-usage snapshot.
 *
 * Thin wrapper around fetchUsage() so the /terminals page (or any
 * other surface that wants live quota state) can pull a typed
 * UsagePayload without crossing the $lib/server boundary on the
 * client. JWPK msg_300r0u8dlx antV4 2026-05-28.
 *
 * Auth: quota/spend telemetry is local operational state, so callers need
 * an authenticated ANT identity or admin-bearer.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { fetchUsage } from '$lib/server/openUsageProxy';

export const GET: RequestHandler = async ({ request }) => {
  requireAggregateReadAuth(request, '/api/usage');
  const payload = await fetchUsage();
  return json(payload);
};
