/**
 * POST /api/policies/presets/jks-validation-rule
 *
 * Thin Validation v1 preset seed. This does not parse documents or
 * replace external tooling; it stores JK's rule in the existing
 * verification policy catalogue so later validation runs can point at it.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CURRENT_TIER, getFeatureFlagsForTier } from '$lib/server/featureGates';
import { resolvePolicyActor } from '$lib/server/policyActor';
import { getPolicyBySlug } from '$lib/server/policyStore';
import {
  JKS_VALIDATION_RULE_SLUG,
  ensureJksValidationRulePolicy
} from '$lib/server/validationPolicyPresets';

export const POST: RequestHandler = async ({ request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_ux) {
    throw error(402, 'Seeding a validation policy preset is a premium feature.');
  }

  const rawBody = await request.json().catch(() => ({}));
  const actor = resolvePolicyActor(request, rawBody);
  if (!actor) throw error(401, 'Identity required to seed a validation policy preset.');

  const existing = getPolicyBySlug(JKS_VALIDATION_RULE_SLUG);
  const policy = ensureJksValidationRulePolicy({
    ownerHandle: actor.handle,
    actorKind: actor.kind
  });

  return json({ policy }, { status: existing?.deletedAtMs === null ? 200 : 201 });
};
