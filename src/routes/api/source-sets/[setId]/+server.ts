/**
 * /api/source-sets/[setId] — single source-set read.
 *
 * GET /api/source-sets/[setId]
 *   -> 200 { sourceSet: SourceSet }
 *   -> 404 not found
 *   -> 403 caller is not admin or org-admin of owner_org
 *
 * Read gate: admin sees all; org-admin sees their org's sets; otherwise 403.
 * Anonymous callers get 401 (different from list, where anon gets [] —
 * here the caller is asking about a specific resource, so refusing is right).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSourceSet } from '$lib/server/sourceSetsStore';
import { isOrgAdmin } from '$lib/server/orgsStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { resolvePolicyActor } from '$lib/server/policyActor';

export const GET: RequestHandler = ({ request, params }) => {
  const setId = params.setId ?? '';
  if (setId.length === 0) throw error(400, 'setId is required.');

  const set = getSourceSet(setId);
  if (!set) throw error(404, 'Source set not found.');

  if (tryAdminBearer(request)) {
    return json({ sourceSet: set });
  }

  const actor = resolvePolicyActor(request, null);
  if (!actor) throw error(401, 'Identity required.');
  if (!isOrgAdmin(set.ownerOrg, actor.handle)) {
    throw error(403, `Caller ${actor.handle} is not org-admin of ${set.ownerOrg}.`);
  }
  return json({ sourceSet: set });
};
