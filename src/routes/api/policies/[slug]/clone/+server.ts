/**
 * POST /api/policies/[slug]/clone — fork a policy under the caller's handle.
 *
 * Premium-gated. Anyone with read access to the source can clone (clone
 * is always allowed for any readable policy, per JWPK's access model).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clonePolicy, getPolicyBySlug, type PolicyVisibility } from '$lib/server/policyStore';
import { resolvePolicyActor } from '$lib/server/policyActor';
import { CURRENT_TIER, getFeatureFlagsForTier } from '$lib/server/featureGates';

export const POST: RequestHandler = async ({ params, request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_ux) {
    throw error(402, 'Cloning a verification policy is a premium feature.');
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'JSON body required.');
  const payload = rawBody as { name?: unknown; visibility?: unknown; reason?: unknown };

  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    throw error(400, 'name is required for the clone.');
  }

  const actor = resolvePolicyActor(request, rawBody);
  if (!actor) throw error(401, 'Identity required.');

  const source = getPolicyBySlug(params.slug);
  if (!source || source.deletedAtMs !== null) throw error(404, 'Source policy not found.');
  if (source.visibility === 'private' && source.ownerHandle !== actor.handle) {
    throw error(403, 'Cannot clone a private policy you do not own.');
  }

  const visibility =
    payload.visibility === 'public' || payload.visibility === 'unlisted' || payload.visibility === 'private'
      ? (payload.visibility as PolicyVisibility)
      : 'public';

  const cloned = clonePolicy({
    sourceSlug: params.slug,
    newName: payload.name,
    newOwnerHandle: actor.handle,
    actorKind: actor.kind,
    visibility,
    reason: typeof payload.reason === 'string' ? payload.reason : null
  });
  if (!cloned) throw error(404, 'Source policy disappeared during clone.');
  return json({ policy: cloned }, { status: 201 });
};
