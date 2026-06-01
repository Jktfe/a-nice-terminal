/**
 * /api/default-agent-kinds/[name] — remove a single default agent-kind chip.
 *
 *   DELETE -> { agentKinds: DefaultAgentKindRow[] }   (the remaining set)
 *
 * See ../+server.ts for the GET/POST/PUT surface + the write-auth note.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { removeDefaultAgentKind } from '$lib/server/defaultCataloguesStore';

export const DELETE: RequestHandler = async ({ params, request }) => {
  if (!tryAdminBearer(request)) throw error(401, 'admin-bearer required');
  const name = (params.name ?? '').trim();
  if (!name) throw error(400, 'DELETE /api/default-agent-kinds/[name] needs a name.');
  return json({ agentKinds: removeDefaultAgentKind(name) });
};
