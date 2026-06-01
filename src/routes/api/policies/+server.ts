/**
 * /api/policies — verification-policy catalogue.
 *
 *   GET   list public + caller's own policies
 *   POST  create one (premium feature; verification_ux flag)
 *
 * Audit writes happen inside policyStore.createPolicy() in the same
 * transaction as the row write — there's no path where a policy lands
 * without an audit row.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createPolicy,
  listPublicPolicies,
  listPoliciesOwnedBy,
  type PolicyBody,
  type PolicyVisibility
} from '$lib/server/policyStore';
import { resolvePolicyActor } from '$lib/server/policyActor';
import { CURRENT_TIER, getFeatureFlagsForTier } from '$lib/server/featureGates';

export const GET: RequestHandler = ({ url, request }) => {
  const ownerFilter = url.searchParams.get('owner');
  let myHandle: string | null = null;
  try {
    const actor = resolvePolicyActor(request, null);
    myHandle = actor?.handle ?? null;
  } catch { /* anonymous list is fine */ }

  const mineOnly = url.searchParams.get('mine') === '1';
  const visible = ownerFilter
    ? listPublicPolicies({ ownerHandle: ownerFilter })
    : listPublicPolicies();
  const mine = myHandle ? listPoliciesOwnedBy(myHandle) : [];

  const seen = new Set(visible.map((policy) => policy.id));
  const myExtras = mine.filter((policy) => !seen.has(policy.id));

  return json({
    policies: mineOnly ? mine : [...visible, ...myExtras],
    myHandle,
    tier: CURRENT_TIER,
    verificationUxEnabled: getFeatureFlagsForTier(CURRENT_TIER).verification_ux
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_ux) {
    throw error(402, 'Verification policies are a premium feature. Upgrade to ANT Native to author policies.');
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

  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    throw error(400, 'name is required.');
  }
  if (!payload.policy || typeof payload.policy !== 'object' || Array.isArray(payload.policy)) {
    throw error(400, 'policy body must be an object.');
  }
  const visibility =
    payload.visibility === 'public' || payload.visibility === 'unlisted' || payload.visibility === 'private'
      ? (payload.visibility as PolicyVisibility)
      : 'public';

  const actor = resolvePolicyActor(request, rawBody);
  if (!actor) throw error(401, 'Identity required to author a verification policy.');

  const created = createPolicy({
    name: payload.name,
    description: typeof payload.description === 'string' ? payload.description : null,
    ownerHandle: actor.handle,
    actorKind: actor.kind,
    policy: payload.policy as PolicyBody,
    visibility,
    reason: typeof payload.reason === 'string' ? payload.reason : null
  });

  return json(created, { status: 201 });
};
