// M3 #3 — Revoke a consent grant

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertNotRoomScoped } from '$lib/server/room-scope';

export async function POST(event: RequestEvent<{ id: string }>) {
  assertNotRoomScoped(event);
  const grant = queries.getConsentGrant(event.params.id);
  if (!grant) return json({ error: 'not found' }, { status: 404 });
  if (grant.status !== 'active') {
    return json({ error: `grant is ${grant.status}, not active` }, { status: 409 });
  }
  queries.revokeConsentGrant(event.params.id);
  const updated = queries.getConsentGrant(event.params.id);
  return json({
    grant: {
      ...updated,
      source_set: typeof updated.source_set === 'string' ? JSON.parse(updated.source_set) : updated.source_set,
    },
  });
}
