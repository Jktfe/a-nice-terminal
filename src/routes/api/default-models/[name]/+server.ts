/**
 * /api/default-models/[name] — remove a single default model chip.
 *
 *   DELETE -> { models: DefaultModelRow[] }   (the remaining set)
 *
 * See ../+server.ts for the GET/POST/PUT surface + the write-auth note.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import { removeDefaultModel } from '$lib/server/defaultCataloguesStore';

export const DELETE: RequestHandler = async ({ params, request }) => {
  // Mutation: ANT_ADMIN_TOKEN (CLI/automation) OR the operator's own browser
  // session (the /settings UI). Mirrors ../+server.ts requireAdminOrOperator.
  if (!tryAdminBearer(request) && !tryOperatorSession(request)) {
    throw error(401, 'admin-bearer or operator session required');
  }
  const name = (params.name ?? '').trim();
  if (!name) throw error(400, 'DELETE /api/default-models/[name] needs a name.');
  return json({ models: removeDefaultModel(name) });
};
