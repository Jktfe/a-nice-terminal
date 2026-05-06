// M3 #3 — Consent Grants API (global scope)
//
// GET  /api/grants?granted_to=@handle&status=active&topic=file-read
// GET  /api/grants/:id
// POST /api/grants/:id/revoke

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertNotRoomScoped } from '$lib/server/room-scope';

export function GET(event: RequestEvent) {
  assertNotRoomScoped(event);
  const url = event.url;
  const grantedTo = url.searchParams.get('granted_to');
  const status = url.searchParams.get('status');
  const topic = url.searchParams.get('topic');

  let grants: any[];
  if (grantedTo) {
    grants = queries.listConsentGrantsByGrantee(grantedTo);
  } else {
    // No global list query yet — require granted_to filter
    grants = [];
  }

  if (status) {
    grants = grants.filter((g: any) => g.status === status);
  }
  if (topic) {
    grants = grants.filter((g: any) => g.topic === topic);
  }

  // Parse source_set JSON for each grant
  const result = grants.map((g: any) => ({
    ...g,
    source_set: typeof g.source_set === 'string' ? JSON.parse(g.source_set) : g.source_set,
  }));

  return json({ grants: result });
}
