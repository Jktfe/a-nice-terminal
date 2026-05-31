/**
 * /api/default-agent-kinds — server-side catalogue of default agent-kind chips.
 *
 *   GET                   -> { agentKinds: DefaultAgentKindRow[] }
 *   POST { name }         -> add one (INSERT OR IGNORE) -> { agentKinds }
 *   PUT  { names: [...] }  -> replace whole set in order -> { agentKinds }
 *
 * Single-entry removal lives at /api/default-agent-kinds/[name] (DELETE).
 * Writes are ungated for now (see /api/default-models/+server.ts note).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listDefaultAgentKinds,
  addDefaultAgentKind,
  replaceDefaultAgentKinds,
  seedDefaultCataloguesIfEmpty
} from '$lib/server/defaultCataloguesStore';

export const GET: RequestHandler = async () => {
  // Self-healing: seed the canonical defaults on first read of a fresh DB.
  seedDefaultCataloguesIfEmpty();
  return json({ agentKinds: listDefaultAgentKinds() });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw error(400, 'POST /api/default-agent-kinds needs a non-empty "name".');
  return json({ agentKinds: addDefaultAgentKind(name) });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
  if (!Array.isArray(body?.names) || !body.names.every((n) => typeof n === 'string')) {
    throw error(400, 'PUT /api/default-agent-kinds needs { names: string[] }.');
  }
  return json({ agentKinds: replaceDefaultAgentKinds(body.names as string[]) });
};
