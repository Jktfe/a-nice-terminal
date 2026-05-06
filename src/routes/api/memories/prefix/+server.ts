// ANT v3 — Prefix scan for memory keys
//
// GET /api/memories/prefix?prefix=tasks/&limit=200
//
// Used by `ant memory list <prefix>` and by `ant agents list`. Returns
// rows ordered by updated_at DESC so the freshest version of each row
// appears first. Prefix is required — this route is not a backdoor for
// listing all memory.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertNotRoomScoped } from '$lib/server/room-scope.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export function GET(event: RequestEvent) {
  assertNotRoomScoped(event);
  const { url } = event;
  const prefix = url.searchParams.get('prefix');
  if (!prefix) throw error(400, 'prefix is required');

  const rawLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.max(1, Math.min(MAX_LIMIT, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));

  const rows = queries.listMemoriesByPrefix(prefix, limit) as any[];
  return json({ prefix, count: rows.length, rows });
}
