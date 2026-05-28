/**
 * GET /api/usage — current open-usage snapshot.
 *
 * Thin wrapper around fetchUsage() so the /terminals page (or any
 * other surface that wants live quota state) can pull a typed
 * UsagePayload without crossing the $lib/server boundary on the
 * client. JWPK msg_300r0u8dlx antV4 2026-05-28.
 *
 * No auth gate: per [[cli-integration-matrix-directive]] this endpoint
 * is operator-only context (your own local daemon, your own machine)
 * and behaves identically whether you're signed in or not. The proxy
 * itself soft-fails when the daemon is missing, so an unauthenticated
 * call still gets a well-formed response.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchUsage } from '$lib/server/openUsageProxy';

export const GET: RequestHandler = async () => {
  const payload = await fetchUsage();
  return json(payload);
};
