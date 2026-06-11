/**
 * /api/terminal-classes — editable account-type + model-family pick-lists
 * for the terminals v3 desk directory (JWPK msg_mc8rejzopg 2026-06-11).
 * Mirrors /api/default-models: GET public, mutations admin-or-operator.
 *
 *   GET   ?cat=account_types|model_families  -> { names: string[] }
 *   POST  ?cat=… { name }                    -> add one      -> { names }
 *   PUT   ?cat=… { names: [...] }            -> replace set  -> { names }
 *   DELETE?cat=… { name }                    -> remove one   -> { names }
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import {
  listSimpleCatalogue,
  addSimpleCatalogueEntry,
  removeSimpleCatalogueEntry,
  replaceSimpleCatalogue,
  seedDefaultCataloguesIfEmpty,
  type SimpleCatalogue
} from '$lib/server/defaultCataloguesStore';

const VALID: SimpleCatalogue[] = ['account_types', 'model_families'];

function catParam(url: URL): SimpleCatalogue {
  const c = url.searchParams.get('cat');
  if (!c || !VALID.includes(c as SimpleCatalogue)) {
    throw error(400, `cat must be one of: ${VALID.join(', ')}`);
  }
  return c as SimpleCatalogue;
}

function requireAdminOrOperator(request: Request): void {
  if (tryAdminBearer(request) || tryOperatorSession(request)) return;
  throw error(401, 'admin-bearer or operator session required');
}

export const GET: RequestHandler = async ({ url }) => {
  seedDefaultCataloguesIfEmpty();
  return json({ names: listSimpleCatalogue(catParam(url)) });
};

export const POST: RequestHandler = async ({ url, request }) => {
  requireAdminOrOperator(request);
  const cat = catParam(url);
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw error(400, 'POST needs a non-empty "name".');
  return json({ names: addSimpleCatalogueEntry(cat, name) });
};

export const PUT: RequestHandler = async ({ url, request }) => {
  requireAdminOrOperator(request);
  const cat = catParam(url);
  const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
  if (!Array.isArray(body?.names) || !body.names.every((n) => typeof n === 'string')) {
    throw error(400, 'PUT needs { names: string[] }.');
  }
  return json({ names: replaceSimpleCatalogue(cat, body.names as string[]) });
};

export const DELETE: RequestHandler = async ({ url, request }) => {
  requireAdminOrOperator(request);
  const cat = catParam(url);
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name : '';
  if (!name) throw error(400, 'DELETE needs a "name".');
  return json({ names: removeSimpleCatalogueEntry(cat, name) });
};
