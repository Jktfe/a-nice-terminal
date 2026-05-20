/**
 * /api/policies/[slug] — single-policy read + owner-gated mutations.
 *
 *   GET     read (public; private rows return 403 unless owner)
 *   PATCH   update — owner only, premium-gated for the UX flag
 *   DELETE  soft-delete — owner only, premium-gated
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getPolicyBySlug,
  softDeletePolicy,
  updatePolicy,
  type PolicyBody,
  type PolicyVisibility
} from '$lib/server/policyStore';
import { resolvePolicyActor } from '$lib/server/policyActor';
import { CURRENT_TIER, getFeatureFlagsForTier } from '$lib/server/featureGates';

function assertReadable(slug: string, callerHandle: string | null) {
  const policy = getPolicyBySlug(slug);
  if (!policy) throw error(404, 'Policy not found.');
  if (policy.deletedAtMs !== null && policy.ownerHandle !== callerHandle) {
    throw error(404, 'Policy not found.');
  }
  if (policy.visibility === 'private' && policy.ownerHandle !== callerHandle) {
    throw error(403, 'Policy is private.');
  }
  return policy;
}

export const GET: RequestHandler = ({ params, request }) => {
  let callerHandle: string | null = null;
  try {
    callerHandle = resolvePolicyActor(request, null)?.handle ?? null;
  } catch { /* anonymous ok */ }
  const policy = assertReadable(params.slug, callerHandle);
  return json({ policy });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_ux) {
    throw error(402, 'Verification policy editing is a premium feature.');
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'JSON body required.');
  const payload = rawBody as {
    name?: unknown;
    description?: unknown;
    policy?: unknown;
    visibility?: unknown;
    reason?: unknown;
  };

  const actor = resolvePolicyActor(request, rawBody);
  if (!actor) throw error(401, 'Identity required.');

  const existing = getPolicyBySlug(params.slug);
  if (!existing || existing.deletedAtMs !== null) throw error(404, 'Policy not found.');
  if (existing.ownerHandle !== actor.handle) throw error(403, 'Only the policy owner can edit it.');

  const updated = updatePolicy({
    slug: params.slug,
    actorHandle: actor.handle,
    actorKind: actor.kind,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    description: payload.description === null
      ? null
      : typeof payload.description === 'string'
        ? payload.description
        : undefined,
    policy: payload.policy && typeof payload.policy === 'object' && !Array.isArray(payload.policy)
      ? (payload.policy as PolicyBody)
      : undefined,
    visibility:
      payload.visibility === 'public' || payload.visibility === 'unlisted' || payload.visibility === 'private'
        ? (payload.visibility as PolicyVisibility)
        : undefined,
    reason: typeof payload.reason === 'string' ? payload.reason : null
  });
  if (!updated) throw error(404, 'Policy not found.');
  return json({ policy: updated });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_ux) {
    throw error(402, 'Verification policy deletion is a premium feature.');
  }

  const rawBody = await request.json().catch(() => null);
  const actor = resolvePolicyActor(request, rawBody);
  if (!actor) throw error(401, 'Identity required.');

  const existing = getPolicyBySlug(params.slug);
  if (!existing || existing.deletedAtMs !== null) throw error(404, 'Policy not found.');
  if (existing.ownerHandle !== actor.handle) throw error(403, 'Only the policy owner can delete it.');

  const reason = rawBody && typeof rawBody === 'object' && typeof (rawBody as { reason?: unknown }).reason === 'string'
    ? (rawBody as { reason: string }).reason
    : null;

  softDeletePolicy(params.slug, actor.handle, actor.kind, reason);
  return new Response(null, { status: 204 });
};
