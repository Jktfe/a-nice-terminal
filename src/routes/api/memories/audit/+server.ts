/**
 * GET /api/memories/audit?key=&limit=
 *   List memory_audit rows newest-first. Filter by key (exact match)
 *   when supplied; cap with limit (default 100, max 1000).
 *
 * Read-only — there is no POST audit verb; audit rows are emitted as a
 * side-effect of put/update/delete in memoriesStore.ts.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { listMemoryAudit } from '$lib/server/memoriesStore';

export const GET: RequestHandler = async ({ request, url }) => {
  requireAggregateReadAuth(request, '/api/memories/audit');
  const keyParam = url.searchParams.get('key');
  const limitRaw = url.searchParams.get('limit');
  const limitParsed = limitRaw === null ? null : Number.parseInt(limitRaw, 10);
  const limit = Number.isFinite(limitParsed) ? limitParsed : null;
  const audit = listMemoryAudit(keyParam, limit);
  return json({ audit });
};
