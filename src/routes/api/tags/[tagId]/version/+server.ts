/**
 * /api/tags/[tagId]/version — D3 wizard substrate (Phase A2 follow-up).
 *
 * PUT — edit a tag: publishes a NEW version row. The old version is
 * retained so historical applications resolve against their original
 * definition (substrate replayable-audit invariant from Slice 1).
 *
 * Body: {
 *   name?:               string,
 *   description?:        string,
 *   protocol_resolver?:  ProtocolResolver,
 *   is_human_editable?:  boolean,
 *   actor_handle:        string,
 *   actor_kind?:         'human'|'agent'|'system',
 *   reason?:             string
 * }
 *   -> 200 { tag: TagDefinition }  (the new version row)
 *   -> 404 tag not found / withdrawn
 *   -> 400 invalid body
 *
 * Auth: admin-bearer (substrate boundary; F1/F2 introduces org-admin role).
 *
 * Surfaces: D3 native Author wizard (iOS) — edit step of the
 * paginated 5-step wizard. M11 Verification Tags page Author view.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { editTag } from '$lib/server/verificationTaxonomyStore';
import type { ProtocolResolver, TagActorKind } from '$lib/server/verificationTaxonomyStore';
import { requireVerificationAuthorTier } from '$lib/server/featureGates';

const VALID_ACTOR = new Set<TagActorKind>(['human', 'agent', 'system']);

function requireAdminBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw error(401, 'Authorization: Bearer <admin-token> required');
  }
  const adminToken = process.env.ANT_ADMIN_TOKEN;
  if (!adminToken || auth.slice(7) !== adminToken) {
    throw error(403, 'Admin bearer required');
  }
}

export const PUT: RequestHandler = async ({ request, params }) => {
  requireAdminBearer(request);
  requireVerificationAuthorTier();
  const tagId = params.tagId;
  if (!tagId) throw error(400, 'tagId required');

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { throw error(400, 'JSON body required'); }

  const actorHandle = body.actor_handle;
  const actorKind = body.actor_kind as TagActorKind | undefined;
  if (typeof actorHandle !== 'string' || !actorHandle) {
    throw error(400, 'actor_handle (string) required');
  }
  if (actorKind !== undefined && !VALID_ACTOR.has(actorKind)) {
    throw error(400, `actor_kind must be one of: ${[...VALID_ACTOR].join(', ')}`);
  }

  // Validate protocol_resolver shape if supplied (substrate store accepts
  // the raw object; we surface obvious shape errors here for 400-not-500).
  let protocolResolver: ProtocolResolver | undefined;
  if (body.protocol_resolver !== undefined) {
    if (!body.protocol_resolver || typeof body.protocol_resolver !== 'object') {
      throw error(400, 'protocol_resolver must be an object');
    }
    protocolResolver = body.protocol_resolver as ProtocolResolver;
  }

  try {
    const tag = editTag({
      id: tagId,
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      protocolResolver,
      isHumanEditable: typeof body.is_human_editable === 'boolean' ? body.is_human_editable : undefined,
      actorHandle,
      actorKind,
      reason: typeof body.reason === 'string' ? body.reason : undefined
    });
    return json({ tag });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg.includes('not found')) throw error(404, msg);
    throw error(400, `editTag failed: ${msg}`);
  }
};
