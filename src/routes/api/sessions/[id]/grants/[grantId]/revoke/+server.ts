// M3 #3 — Revoke a consent grant (session-scoped)

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertSameRoom, assertCanWrite } from '$lib/server/room-scope';

export async function POST(event: RequestEvent<{ id: string; grantId: string }>) {
  assertSameRoom(event, event.params.id);
  assertCanWrite(event);
  const grant = queries.getConsentGrant(event.params.grantId);
  if (!grant) return json({ error: 'not found' }, { status: 404 });
  if (grant.session_id !== event.params.id) return json({ error: 'grant does not belong to this session' }, { status: 403 });
  if (grant.status !== 'active') {
    return json({ error: `grant is ${grant.status}, not active` }, { status: 409 });
  }
  queries.revokeConsentGrant(event.params.grantId);
  const updated = queries.getConsentGrant(event.params.grantId);
  return json({
    grant: {
      ...updated,
      source_set: typeof updated.source_set === 'string' ? JSON.parse(updated.source_set) : updated.source_set,
    },
  });
}
