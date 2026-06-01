/**
 * GET /api/validation-runs/by-claim?claimAnchor=...
 *
 * Returns validation runs for a given claim anchor directly.
 * Used by Stage deck claim overlay (v2) to show per-claim verification
 * status without requiring a taskId.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listValidationRunsForClaim } from '$lib/server/validationLensStore';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';

export const GET: RequestHandler = async ({ url, request }) => {
  const caller = resolveCallerHandleAnyRoom(request);
  if (!caller) throw error(401, 'Authentication required.');

  const claimAnchor = url.searchParams.get('claimAnchor');
  if (!claimAnchor || claimAnchor.trim().length === 0) {
    throw error(400, 'claimAnchor query parameter is required.');
  }

  const runs = listValidationRunsForClaim(claimAnchor.trim());
  return json({ runs });
};
