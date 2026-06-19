/**
 * GET /api/chair → the chair's per-room digest array.
 *
 * Backs M29 chair session-tracker slice 1. Slice 1 ships heuristic digests
 * (message counts, last-message summary, freshness, attention reason).
 * Slice 2 swaps to a cheap-model LLM digest using the chair role on the
 * session-tracking task type.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { listChairDigest } from '$lib/server/chairStore';

export const GET: RequestHandler = async ({ request }) => {
  requireAggregateReadAuth(request, '/api/chair');
  return json({ chairDigest: listChairDigest() });
};
