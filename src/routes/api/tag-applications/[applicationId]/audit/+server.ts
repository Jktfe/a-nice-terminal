/**
 * /api/tag-applications/[applicationId]/audit — D5 substrate
 * (Phase A5 audit endpoint wrapper).
 *
 * GET — returns the override chain for this tag application,
 * newest-first per the store invariant. Used by:
 *   - D5 iOS audit feed (per-application override history)
 *   - M12 Mac per-application override audit pane
 *   - Verification Tags page Audit view (per-claim drill-down)
 *
 * Response:
 *   {
 *     overrides: Array<{
 *       id, tagApplicationId, overrideKind, newProtocolClass,
 *       handlerHandle, handlerKind, reason, createdAtMs
 *     }>,
 *     effective: { kind, ... } | null   // computed from chain
 *   }
 *
 * Open read per substrate trust-surface model. Audit is documentation,
 * not credentials — agents reading their own actions / users seeing
 * verifier history should not need auth.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getEffectiveOverride,
  listOverridesForApplication
} from '$lib/server/tagApplicationOverridesStore';

export const GET: RequestHandler = async ({ params }) => {
  const applicationId = params.applicationId;
  if (!applicationId) throw error(400, 'applicationId required');
  const overrides = listOverridesForApplication(applicationId);
  const effective = getEffectiveOverride(applicationId);
  return json({ overrides, effective });
};
