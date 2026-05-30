/**
 * /api/tags/[tagId]/deprecate — V2-server Phase A9 Slice 7b.
 *
 * POST body: { actor_handle, actor_kind, reason?, replacement_tag_id? }
 *   -> 200 { tag: TagDefinition }   (the deprecated/superseded latest row)
 *   -> 400 invalid input
 *   -> 404 tag not found
 *
 * When replacement_tag_id is supplied, lifecycle moves to `superseded`
 * + superseded_by_id is set. Otherwise lifecycle moves to `deprecated`.
 *
 * Auth: admin-bearer (substrate boundary; org-admin role under F1/F2).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deprecateTag } from '$lib/server/verificationTaxonomyStore';
import type { TagActorKind } from '$lib/server/verificationTaxonomyStore';
import { requireVerificationAuthorTier } from '$lib/server/featureGates';

const VALID_ACTOR = new Set<TagActorKind>(['human', 'agent', 'system']);

function requireAdminBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw error(401, 'Authorization: Bearer <admin-token> required');
  }
  const adminToken = process.env.ANT_ADMIN_BEARER;
  if (!adminToken || auth.slice(7) !== adminToken) {
    throw error(403, 'Admin bearer required');
  }
}

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminBearer(request);
  requireVerificationAuthorTier();
  const tagId = params.tagId;
  if (!tagId) throw error(400, 'tagId required');

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { throw error(400, 'JSON body required'); }

  const actorHandle = body.actor_handle;
  const actorKind = body.actor_kind as TagActorKind;
  if (typeof actorHandle !== 'string' || !actorHandle) {
    throw error(400, 'actor_handle (string) required');
  }
  if (!VALID_ACTOR.has(actorKind)) {
    throw error(400, `actor_kind must be one of: ${[...VALID_ACTOR].join(', ')}`);
  }

  try {
    const tag = deprecateTag({
      id: tagId,
      actorHandle,
      actorKind,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      replacementTagId: typeof body.replacement_tag_id === 'string' ? body.replacement_tag_id : undefined
    });
    return json({ tag });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg.includes('not found')) throw error(404, msg);
    throw error(400, `deprecateTag failed: ${msg}`);
  }
};
