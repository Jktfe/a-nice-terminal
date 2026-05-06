// M3 #3 — Single grant API

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertNotRoomScoped } from '$lib/server/room-scope';

export function GET(event: RequestEvent<{ id: string }>) {
  assertNotRoomScoped(event);
  const grant = queries.getConsentGrant(event.params.id);
  if (!grant) return json({ error: 'not found' }, { status: 404 });
  return json({
    grant: {
      ...grant,
      source_set: typeof grant.source_set === 'string' ? JSON.parse(grant.source_set) : grant.source_set,
    },
  });
}
