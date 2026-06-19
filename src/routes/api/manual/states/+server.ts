// GET /api/manual/states — list all manual_screen_states for the
// /manual/v2 canvas (slice 1, JWPK 2026-05-23). Workspace read:
// any authenticated user can fetch the catalogue.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listScreenStates } from '$lib/server/manualScreenStore';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';

export const GET: RequestHandler = async ({ request }) => {
  requireAggregateReadAuth(request, '/api/manual/states');
  return json({ states: listScreenStates() });
};
