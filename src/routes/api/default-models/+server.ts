/**
 * /api/default-models — server-side catalogue of default model chips.
 *
 *   GET                  -> { models: DefaultModelRow[] }  (sort_order asc)
 *   POST { name }        -> add one (INSERT OR IGNORE) -> { models }
 *   PUT  { names: [...] } -> replace whole set in order  -> { models }
 *
 * AUTH: GET is public (anyone may READ the shared chip catalogue). All
 * MUTATIONS (POST / PUT / DELETE [name]) require EITHER the server-side
 * ANT_ADMIN_TOKEN (CLI/automation) OR the operator's own authenticated
 * `ant_browser_session` — so the antOS /settings UI can persist edits
 * without the raw admin token ever reaching the browser, while any other
 * caller is still rejected. The catalogue is shared server state, so editing
 * it stays a privileged, owner-scoped op. (Closes the "write-from-UI" +
 * "ungated for now" follow-ups flagged when this moved off per-browser
 * localStorage onto the server.)
 *
 * Removal of a single entry lives at /api/default-models/[name] (DELETE).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import {
  listDefaultModels,
  addDefaultModel,
  replaceDefaultModels,
  seedDefaultCataloguesIfEmpty
} from '$lib/server/defaultCataloguesStore';

function requireAdminOrOperator(request: Request): void {
  // Privileged + owner-scoped: ANT_ADMIN_TOKEN (CLI/automation) OR the
  // operator's own authenticated browser session (so the /settings UI can
  // persist without the raw admin token reaching the browser). Else 401.
  if (tryAdminBearer(request) || tryOperatorSession(request)) return;
  throw error(401, 'admin-bearer or operator session required');
}

export const GET: RequestHandler = async () => {
  // Self-healing: a fresh DB has the (empty) table from the schema
  // bootstrap; this populates the canonical defaults on first read.
  seedDefaultCataloguesIfEmpty();
  return json({ models: listDefaultModels() });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdminOrOperator(request);
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw error(400, 'POST /api/default-models needs a non-empty "name".');
  return json({ models: addDefaultModel(name) });
};

export const PUT: RequestHandler = async ({ request }) => {
  requireAdminOrOperator(request);
  const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
  if (!Array.isArray(body?.names) || !body.names.every((n) => typeof n === 'string')) {
    throw error(400, 'PUT /api/default-models needs { names: string[] }.');
  }
  return json({ models: replaceDefaultModels(body.names as string[]) });
};
