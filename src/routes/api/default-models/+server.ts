/**
 * /api/default-models — server-side catalogue of default model chips.
 *
 *   GET                  -> { models: DefaultModelRow[] }  (sort_order asc)
 *   POST { name }        -> add one (INSERT OR IGNORE) -> { models }
 *   PUT  { names: [...] } -> replace whole set in order  -> { models }
 *
 * Writes are intentionally ungated for now — this mirrors the previous
 * behaviour where any client could edit its localStorage chip list. Moving
 * to a shared server list makes "who can edit" a real question; gating
 * (admin-bearer) is a deliberate follow-up, tracked in the capability ledger.
 *
 * Removal of a single entry lives at /api/default-models/[name] (DELETE).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listDefaultModels,
  addDefaultModel,
  replaceDefaultModels,
  seedDefaultCataloguesIfEmpty
} from '$lib/server/defaultCataloguesStore';

export const GET: RequestHandler = async () => {
  // Self-healing: a fresh DB has the (empty) table from the schema
  // bootstrap; this populates the canonical defaults on first read.
  seedDefaultCataloguesIfEmpty();
  return json({ models: listDefaultModels() });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw error(400, 'POST /api/default-models needs a non-empty "name".');
  return json({ models: addDefaultModel(name) });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
  if (!Array.isArray(body?.names) || !body.names.every((n) => typeof n === 'string')) {
    throw error(400, 'PUT /api/default-models needs { names: string[] }.');
  }
  return json({ models: replaceDefaultModels(body.names as string[]) });
};
