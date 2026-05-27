/**
 * /api/verification/lenses/:lensId — read/update/archive one V2 lens.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CURRENT_TIER, getFeatureFlagsForTier } from '$lib/server/featureGates';
import {
  archiveValidationSchemaWithAudit,
  updateValidationSchema
} from '$lib/server/validationLensStore';
import {
  lensResponse,
  parseLensKind,
  parseScope,
  requireReadableLens,
  requireWritableLens,
  resolveLensActor,
  scopeIdFor,
  stringifyStrictLensRules
} from '$lib/server/verificationLensApi';

type UpdateLensPayload = {
  name?: unknown;
  description?: unknown;
  lensKind?: unknown;
  scope?: unknown;
  scopeId?: unknown;
  rules?: unknown;
  reason?: unknown;
};

export const GET: RequestHandler = ({ params, request }) => {
  const actor = resolveLensActor(request, null);
  const lens = requireReadableLens(params.lensId, actor);
  return json({ lens: lensResponse(lens) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_ux) throw error(402, 'Lens editing is a premium feature.');

  const rawBody = await request.json().catch(() => null) as UpdateLensPayload | null;
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'JSON body required.');
  const actor = resolveLensActor(request, rawBody);
  if (!actor) throw error(401, 'Identity required.');
  const existing = requireWritableLens(params.lensId, actor);

  const nextScope = rawBody.scope === undefined ? undefined : parseScope(rawBody.scope);
  const updated = updateValidationSchema({
    id: existing.id,
    actorHandle: actor.handle,
    actorKind: actor.kind,
    name: typeof rawBody.name === 'string' ? rawBody.name : undefined,
    description: rawBody.description === null
      ? null
      : typeof rawBody.description === 'string'
        ? rawBody.description
        : undefined,
    lensKind: rawBody.lensKind === undefined ? undefined : parseLensKind(rawBody.lensKind),
    scope: nextScope,
    scopeId: nextScope ? scopeIdFor(nextScope, actor, rawBody.scopeId) : undefined,
    rulesJson: rawBody.rules === undefined ? undefined : stringifyStrictLensRules(rawBody.rules),
    reason: typeof rawBody.reason === 'string' ? rawBody.reason : null
  });
  if (!updated) throw error(404, 'Lens not found.');
  return json({ lens: lensResponse(updated) });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_ux) throw error(402, 'Lens deletion is a premium feature.');

  const rawBody = await request.json().catch(() => null) as { reason?: unknown } | null;
  const actor = resolveLensActor(request, rawBody);
  if (!actor) throw error(401, 'Identity required.');
  const existing = requireWritableLens(params.lensId, actor);
  const archived = archiveValidationSchemaWithAudit({
    id: existing.id,
    actorHandle: actor.handle,
    actorKind: actor.kind,
    reason: rawBody && typeof rawBody.reason === 'string' ? rawBody.reason : null
  });
  if (!archived) throw error(404, 'Lens not found.');
  return new Response(null, { status: 204 });
};
