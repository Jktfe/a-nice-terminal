/**
 * /api/default-models — server-side catalogue of default model chips.
 *
 *   GET                  -> { models: DefaultModelRow[] }  (sort_order asc)
 *   POST { name }        -> add one (INSERT OR IGNORE) -> { models }
 *   PUT  { names: [...] } -> replace whole set in order  -> { models }
 *
 * AUTH: GET is public (anyone may READ the shared chip catalogue). All
 * MUTATIONS (POST / PUT / DELETE [name]) require admin-bearer — the
 * catalogue is shared server state, so editing it is a privileged op. This
 * matches the sibling /api/roles endpoint's requireAdmin pattern. (Closes
 * the "ungated for now" follow-up flagged when this moved off per-browser
 * localStorage onto the server.)
 *
 * Removal of a single entry lives at /api/default-models/[name] (DELETE).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import {
  listDefaultModels,
  addDefaultModel,
  replaceDefaultModels,
  seedDefaultCataloguesIfEmpty
} from '$lib/server/defaultCataloguesStore';

function requireAdmin(request: Request): void {
  if (!tryAdminBearer(request)) throw error(401, 'admin-bearer required');
}

export const GET: RequestHandler = async () => {
  // Self-healing: a fresh DB has the (empty) table from the schema
  // bootstrap; this populates the canonical defaults on first read.
  seedDefaultCataloguesIfEmpty();
  return json({ models: listDefaultModels() });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdmin(request);
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw error(400, 'POST /api/default-models needs a non-empty "name".');
  return json({ models: addDefaultModel(name) });
};

export const PUT: RequestHandler = async ({ request }) => {
  requireAdmin(request);
  const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
  if (!Array.isArray(body?.names) || !body.names.every((n) => typeof n === 'string')) {
    throw error(400, 'PUT /api/default-models needs { names: string[] }.');
  }
  return json({ models: replaceDefaultModels(body.names as string[]) });
};
