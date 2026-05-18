// M3 #3 — Single grant under session scope

import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertSameRoom } from '$lib/server/room-scope';

function requireActiveChatSession(sessionId: string) {
  const session = queries.getSession(sessionId) as any;
  if (!session) {
    throw error(404, 'Session not found');
  }
  if (session.archived || session.deleted_at) {
    throw error(410, 'Session is inactive');
  }
  if (session.type !== 'chat') {
    throw error(400, 'Consent grants are only available for chat sessions');
  }
  return session;
}

export function GET(event: RequestEvent<{ id: string; grantId: string }>) {
  assertSameRoom(event, event.params.id);
  requireActiveChatSession(event.params.id);
  const grant = queries.getConsentGrant(event.params.grantId);
  if (!grant) return json({ error: 'not found' }, { status: 404 });
  if (grant.session_id !== event.params.id) return json({ error: 'grant does not belong to this session' }, { status: 403 });
  return json({
    grant: {
      ...grant,
      source_set: typeof grant.source_set === 'string' ? JSON.parse(grant.source_set) : grant.source_set,
    },
  });
}
