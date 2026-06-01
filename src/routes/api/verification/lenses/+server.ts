/**
 * /api/verification/lenses — premium app-facing lens CRUD.
 *
 * This route stores the V2 lens authoring shape in verification_lenses.rules_json.
 * Claude's lensRulesBridge lowers that shape to executable PolicyBody for the
 * current scorer/orchestrator while native apps consume the richer V2 contract.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireVerificationAuthorTier } from '$lib/server/featureGates';
import {
  createValidationSchema,
  listValidationSchemas,
  recordValidationSchemaAudit
} from '$lib/server/validationLensStore';
import {
  lensResponse,
  normalizeLensId,
  parseLensKind,
  parseScope,
  resolveLensActor,
  scopeIdFor,
  stringifyStrictLensRules,
  visibilityForActor
} from '$lib/server/verificationLensApi';

type CreateLensPayload = {
  name?: unknown;
  description?: unknown;
  lensKind?: unknown;
  scope?: unknown;
  scopeId?: unknown;
  rules?: unknown;
  reason?: unknown;
};

export const GET: RequestHandler = ({ request }) => {
  const actor = resolveLensActor(request, null);
  const schemas = listValidationSchemas({ visibleTo: visibilityForActor(actor) });
  return json({ lenses: schemas.map(lensResponse) });
};

export const POST: RequestHandler = async ({ request }) => {
  requireVerificationAuthorTier();

  const rawBody = await request.json().catch(() => null) as CreateLensPayload | null;
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'JSON body required.');
  const actor = resolveLensActor(request, rawBody);
  if (!actor) throw error(401, 'Identity required.');
  if (typeof rawBody.name !== 'string' || rawBody.name.trim().length === 0) throw error(400, 'name is required.');

  const scope = parseScope(rawBody.scope);
  const scopeId = scopeIdFor(scope, actor, rawBody.scopeId);
  const rulesJson = stringifyStrictLensRules(rawBody.rules ?? {});
  const lens = createValidationSchema({
    id: normalizeLensId(rawBody.name),
    name: rawBody.name.trim(),
    description: typeof rawBody.description === 'string' ? rawBody.description : null,
    lensKind: parseLensKind(rawBody.lensKind),
    scope,
    scopeId,
    rulesJson,
    createdBy: actor.handle,
    archivedAtMs: null
  });
  recordValidationSchemaAudit({
    schemaId: lens.id,
    actorHandle: actor.handle,
    actorKind: actor.kind,
    action: 'create',
    before: null,
    after: lensResponse(lens),
    reason: typeof rawBody.reason === 'string' ? rawBody.reason : null
  });
  return json({ lens: lensResponse(lens) }, { status: 201 });
};
